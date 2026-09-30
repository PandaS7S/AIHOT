import { randomUUID, createHash } from 'node:crypto';
import { sql, type Db } from '../db.ts';
import { normalizeUrl } from '../lib/url.ts';
import { enqueue } from '../jobs/queue.ts';
import { evidenceSchema, targetSchema, type Evidence, type Target } from './schema.ts';
export const RESEARCH_QUEUE='research.run';
export const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export async function createTarget(raw: unknown): Promise<Target> {
 const d=targetSchema.parse(raw); const id=randomUUID();
 const terms=d.terms.length?d.terms:[...new Set(d.question.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu)??[])].slice(0,15);
 const [t]=await sql<Target[]>`INSERT INTO research_targets(id,question,domain,hypothesis,terms,public_terms) VALUES(${id},${d.question},${d.domain},${d.hypothesis??null},${terms},${d.publicTerms}) RETURNING *`;
 return t;
}
export async function ingestEvidence(raw:unknown, extra:{articleId?:string;revision?:number}={}, db:Db=sql):Promise<Evidence> {
 const d=evidenceSchema.parse(raw); const url=normalizeUrl(d.url); if(!url)throw new Error('invalid_url');
 const identity=extra.articleId?`article:${extra.articleId}`:url;
 const h=hash([d.title,d.body,d.claims,d.publishedAt,d.occurredAt,d.timePrecision,d.originKey??url]);
 // Immutable versions; never overwrite available_at with an asserted publication date.
 await db`SELECT pg_advisory_xact_lock(hashtext(${identity}))`;
 const [previous]=await db<{id:string}[]>`SELECT id FROM research_evidence WHERE identity=${identity} ORDER BY available_at DESC,id DESC LIMIT 1`;
 const [e]=await db<Evidence[]>`INSERT INTO research_evidence(id,identity,content_hash,previous_id,article_id,article_revision,title,url,source,origin_key,body,claims,domain,published_at,occurred_at,time_precision,mode)
 VALUES(${randomUUID()},${identity},${h},${previous?.id??null},${extra.articleId??null},${extra.revision??null},${d.title},${url},${d.source},${d.originKey??url},${d.body},${db.json(d.claims as never)},${d.domain},${d.publishedAt},${d.occurredAt},${d.timePrecision},${d.mode})
 ON CONFLICT(identity,content_hash) DO UPDATE SET identity=EXCLUDED.identity RETURNING *`;
 return e;
}
export async function saveEvidence(raw:unknown):Promise<Evidence> {
 const e=await sql.begin(tx=>ingestEvidence(raw,{},tx)) as Evidence;
 await scheduleTargets('evidence'); return e;
}
/** Corpus recall bypasses all public selection/AI relevance filters. UNKNOWN remains visible. */
export async function recall(t:Target,db:Db=sql):Promise<Evidence[]> {
 return db<Evidence[]>`SELECT * FROM (
 SELECT DISTINCT ON(identity) * FROM research_evidence ORDER BY identity,available_at DESC,id DESC
 ) e WHERE fetch_status='ok' AND ((${t.domain}='unknown' AND domain='unknown') OR (domain=${t.domain} AND domain<>'unknown') OR EXISTS (
 SELECT 1 FROM unnest(${t.terms}::text[]) term WHERE lower(title || ' ' || body) LIKE '%' || lower(term) || '%'))
 ORDER BY available_at DESC,id DESC LIMIT 60`;
}
export async function requestRun(targetId:string, trigger='manual', queue=true):Promise<Record<string,unknown>|null> {
 const run=await sql.begin(async tx=>{
 const [t]=await tx<Target[]>`SELECT * FROM research_targets WHERE id=${targetId} FOR UPDATE`; if(!t||t.status!=='active')return null;
 const evidence=await recall(t,tx); const snapshot={target:t,evidenceIds:evidence.map(e=>e.id).sort(),cutoff:new Date().toISOString()};
 const external=process.env.RESEARCH_FETCH_ENABLED==='true'||(process.env.RESEARCH_SEARCH_ENABLED==='true'&&t.public_terms.length>0);
 const refreshEpoch=external?Math.floor(Date.now()/3600000):'corpus';
 const inputKey=hash([t.version,snapshot.evidenceIds,process.env.RESEARCH_PROVIDER??'none','research-v1',refreshEpoch]);
 const [r]=await tx`INSERT INTO research_runs(id,target_id,target_version,input_key,snapshot,trigger)
 VALUES(${randomUUID()},${t.id},${t.version},${inputKey},${tx.json(snapshot as never)},${trigger})
 ON CONFLICT(target_id,target_version,input_key) DO UPDATE SET input_key=EXCLUDED.input_key RETURNING *`;
 return r;
 });
 if(run && queue && run.status==='queued')await enqueue(RESEARCH_QUEUE,{runId:run.id},{singletonKey:String(run.id)});
 return run;
}
export async function scheduleTargets(trigger:string) {
 const targets=await sql<{id:string}[]>`SELECT id FROM research_targets WHERE status='active'`;
 for(const t of targets)await requestRun(t.id,trigger);
}
/** Called on a recurring sweep: body extraction may update without an article revision. */
export async function syncCorpus() {
 const articles=await sql<{id:string;revision:number;title:string;url:string;source:string;body:string;published_at:Date|null}[]>`
 SELECT a.id,a.revision,a.title,a.url,s.name source,coalesce(a.body_text,a.excerpt,a.title) body,a.published_at
 FROM articles a JOIN sources s ON a.source_id=s.id
 WHERE NOT EXISTS(SELECT 1 FROM research_evidence e WHERE e.article_id=a.id AND e.article_revision=a.revision AND e.body=coalesce(a.body_text,a.excerpt,a.title) AND e.title=a.title)
 ORDER BY a.updated_at DESC LIMIT 100`;
 for(const a of articles)await sql.begin(tx=>ingestEvidence({title:a.title,url:a.url,source:a.source,body:a.body,publishedAt:a.published_at?.toISOString()??null,timePrecision:'unknown',mode:'source'}, {articleId:a.id,revision:a.revision},tx));
 await scheduleTargets('corpus-sweep');
 // Recover a committed run whose process died before enqueuing, without reopening terminal failures.
 const waiting=await sql<{id:string}[]>`SELECT id FROM research_runs WHERE status IN ('queued','running') ORDER BY created_at LIMIT 100`;
 for(const r of waiting)await enqueue(RESEARCH_QUEUE,{runId:r.id},{singletonKey:r.id});
 return {ingested:articles.length};
}
export async function overview() {
 const [targets,radar,runs,coverage,exploration,sourceHealth]=await Promise.all([
 sql`SELECT * FROM research_targets ORDER BY created_at DESC`,
 sql`SELECT b.*,t.question FROM research_briefs b JOIN research_targets t ON b.target_id=t.id ORDER BY b.created_at DESC LIMIT 12`,
 sql`SELECT id,target_id,status,steps,calls,max_calls,stop_reason,created_at,finished_at FROM research_runs ORDER BY created_at DESC LIMIT 30`,
 sql`SELECT source,mode,count(*) versions,max(available_at) last_success FROM research_evidence GROUP BY source,mode ORDER BY source`,
 sql`SELECT id,title,url,source,mode,domain,available_at,published_at,previous_id FROM research_evidence ORDER BY available_at DESC LIMIT 15`,
 sql`SELECT id,name,health,last_fetch_at,last_ok_at,fail_count FROM sources WHERE enabled ORDER BY name`
 ]);
 return {targets,radar,runs,coverage,exploration,sourceHealth,capabilities:{corpus:'configured',officialFetch:process.env.RESEARCH_FETCH_ENABLED==='true'?'configured':'not_configured',webSearch:process.env.RESEARCH_SEARCH_ENABLED==='true'&&process.env.RESEARCH_SEARCH_URL?'configured (opt-in public terms only)':'not_configured',analysis:process.env.RESEARCH_PROVIDER??'not_configured'}, timezone:'Pacific/Auckland'};
}
export async function detail(id:string) {
 const [target]=await sql`SELECT * FROM research_targets WHERE id=${id}`;if(!target)return null;
 const [briefs,runs,actions]=await Promise.all([sql`SELECT * FROM research_briefs WHERE target_id=${id} ORDER BY created_at DESC`,sql`SELECT * FROM research_runs WHERE target_id=${id} ORDER BY created_at DESC`,sql`SELECT * FROM research_actions WHERE target_id=${id} ORDER BY created_at DESC`]);
 const citedIds=[...new Set(briefs.flatMap(b=>b.input_ids as string[]))];
 const historical=citedIds.length?await sql<Evidence[]>`SELECT * FROM research_evidence WHERE id=ANY(${citedIds}::text[]) ORDER BY available_at DESC`:[];
 const current=await recall(target as Target);
 const evidence=[...new Map([...current,...historical].map(e=>[e.id,e])).values()];
 return {target,briefs,runs,actions,evidence};
}
