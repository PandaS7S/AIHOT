import { randomUUID, createHash } from 'node:crypto';
import { sql, type Db } from '../db.ts';
import { normalizeUrl } from '../lib/url.ts';
import { enqueue } from '../jobs/queue.ts';
import { config, credential } from '../config.ts';
import { searchConfigured } from './search.ts';
import { DOMAINS, evidenceSchema, targetSchema, type Evidence, type Target } from './schema.ts';
export const RESEARCH_QUEUE='research.run';
export const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
/** Local-only keyword recall; Chinese questions must not become one unmatchable sentence. */
export function questionTerms(question: string): string[] {
 const stop = new Set(['如何','是否','影响','研究','目前','哪些','什么','情况','这个','我们','可以','以及']);
 const words = [...new Intl.Segmenter('zh', { granularity: 'word' }).segment(question.toLowerCase())]
  .filter(s => s.isWordLike && s.segment.length >= 2 && !stop.has(s.segment)).map(s => s.segment);
 const latin = question.toLowerCase().match(/[a-z0-9][a-z0-9._-]+/g) ?? [];
 const aliases: Record<string,string[]> = { '通胀':['inflation','cpi'], '利率':['interest rate','fomc'], '比特币':['bitcoin','btc'], '降息':['rate cut'], '财报':['earnings'], '关税':['tariff'], '成本':['cost','pricing'], '模型':['model','llm'] };
 const extra = Object.entries(aliases).filter(([word]) => question.includes(word)).flatMap(([,terms]) => terms);
 return [...new Set([...latin,...extra,...words])].slice(0,15);
}
export async function createTarget(raw: unknown): Promise<Target> {
 const d=targetSchema.parse(raw); const id=randomUUID();
 const terms=d.terms.length?d.terms:questionTerms(d.question);
 const [t]=await sql<Target[]>`INSERT INTO research_targets(id,question,domain,hypothesis,terms,public_terms,scope) VALUES(${id},${d.question},${d.domain},${d.hypothesis??null},${terms},${d.publicTerms},${sql.json(d.scope)}) RETURNING *`;
 return t;
}
export async function updateTarget(id: string, raw: unknown): Promise<Target | null> {
 const d=targetSchema.parse(raw);
 const terms=d.terms.length?d.terms:questionTerms(d.question);
 const [t]=await sql<Target[]>`UPDATE research_targets SET version=version+1,question=${d.question},domain=${d.domain},hypothesis=${d.hypothesis??null},terms=${terms},public_terms=${d.publicTerms},scope=${sql.json(d.scope)},updated_at=now() WHERE id=${id} RETURNING *`;
 return t??null;
}
export async function ingestEvidence(raw:unknown, extra:{articleId?:string;revision?:number}={}, db:Db=sql):Promise<Evidence> {
 if(db===sql)return sql.begin(tx=>ingestEvidence(raw,extra,tx)) as Promise<Evidence>;
 const d=evidenceSchema.parse(raw); const url=normalizeUrl(d.url); if(!url)throw new Error('invalid_url');
 // A search excerpt must not replace the acquired source document at the same URL.
 const snippet=/^(search-snippet|synthetic-search):/.test(d.source);
 const identity=extra.articleId?`article:${extra.articleId}`:snippet?`snippet:${url}`:url;
 const h=hash([d.title,d.body,d.claims,d.publishedAt,d.occurredAt,d.timePrecision,d.originKey??url,d.domain,d.source,d.mode,d.timeMetadata,extra.revision??null]);
 // Immutable versions; never overwrite available_at with an asserted publication date.
 await db`SELECT pg_advisory_xact_lock(hashtext(${identity}))`;
 const [previous]=await db<(Evidence & {content_hash:string;version_seq:number})[]>`SELECT * FROM research_evidence WHERE identity=${identity} ORDER BY version_seq DESC LIMIT 1`;
 if(previous?.content_hash===h)return previous;
 // A -> B -> A is a new revision; deduplicating against every historical hash would leave B current.
 const [e]=await db<Evidence[]>`INSERT INTO research_evidence(id,identity,content_hash,version_seq,previous_id,article_id,article_revision,title,url,source,origin_key,body,claims,domain,published_at,occurred_at,time_precision,time_metadata,mode)
 VALUES(${randomUUID()},${identity},${h},${(previous?.version_seq??0)+1},${previous?.id??null},${extra.articleId??null},${extra.revision??null},${d.title},${url},${d.source},${d.originKey??url},${d.body},${db.json(d.claims as never)},${d.domain},${d.publishedAt},${d.occurredAt},${d.timePrecision},${db.json(d.timeMetadata)},${d.mode}) RETURNING *`;
 return e;
}
export async function saveEvidence(raw:unknown):Promise<Evidence> {
 const e=await sql.begin(tx=>ingestEvidence(raw,{},tx)) as Evidence;
 await scheduleTargets('evidence'); return e;
}
/** Corpus recall bypasses all public selection/AI relevance filters. UNKNOWN remains visible. */
export async function recall(t:Target,db:Db=sql):Promise<Evidence[]> {
 return db<Evidence[]>`SELECT * FROM (
 SELECT DISTINCT ON(identity) * FROM research_evidence ORDER BY identity,version_seq DESC
 ) e WHERE fetch_status='ok' AND ((${t.domain}='unknown' AND domain='unknown') OR (domain=${t.domain} AND domain<>'unknown') OR EXISTS (
 SELECT 1 FROM unnest(${t.terms}::text[]) term WHERE lower(title || ' ' || body) LIKE '%' || lower(term) || '%'))
 ORDER BY (SELECT count(*) FROM unnest(${t.terms}::text[]) term WHERE lower(title || ' ' || body) LIKE '%' || lower(term) || '%') DESC,available_at DESC,id DESC LIMIT 60`;
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
 const articles=await sql<{id:string;revision:number;title:string;url:string;source:string;body:string;published_at:Date|null;domain:string}[]>`
 WITH current AS (
  SELECT a.id,a.revision,left(a.title,600) title,a.url,s.name source,left(coalesce(nullif(a.body_text,''),nullif(a.excerpt,''),a.title),50000) body,a.published_at,a.updated_at,
  CASE WHEN s.config->>'researchDomain'=ANY(${[...DOMAINS]}::text[]) THEN s.config->>'researchDomain' ELSE 'unknown' END domain
  FROM articles a JOIN sources s ON a.source_id=s.id
 ) SELECT c.* FROM current c
 LEFT JOIN LATERAL (SELECT * FROM research_evidence WHERE identity='article:'||c.id ORDER BY version_seq DESC LIMIT 1) e ON true
 WHERE e.id IS NULL OR (e.article_revision,e.body,e.title,e.domain,e.source,e.published_at) IS DISTINCT FROM (c.revision,c.body,c.title,c.domain,c.source,c.published_at)
 ORDER BY c.updated_at DESC LIMIT 100`;
 for(const a of articles)await sql.begin(tx=>ingestEvidence({title:a.title,url:a.url,source:a.source,body:a.body,domain:DOMAINS.includes(a.domain as (typeof DOMAINS)[number])?a.domain:'unknown',publishedAt:a.published_at?.toISOString()??null,timePrecision:'unknown',mode:'source'}, {articleId:a.id,revision:a.revision},tx));
 await scheduleTargets('corpus-sweep');
 // Recover a committed run whose process died before enqueuing, without reopening terminal failures.
 const waiting=await sql<{id:string}[]>`SELECT id FROM research_runs WHERE status IN ('queued','running') ORDER BY created_at LIMIT 100`;
 for(const r of waiting)await enqueue(RESEARCH_QUEUE,{runId:r.id},{singletonKey:r.id});
 return {ingested:articles.length};
}
export async function overview() {
 const [targets,radar,runs,coverage,exploration,sourceHealth]=await Promise.all([
 sql`SELECT * FROM research_targets ORDER BY created_at DESC`,
 sql`SELECT b.*,r.snapshot->'target'->>'question' question FROM research_briefs b JOIN research_runs r ON b.run_id=r.id ORDER BY b.created_at DESC LIMIT 12`,
 sql`SELECT id,target_id,status,steps,calls,max_calls,stop_reason,created_at,finished_at FROM research_runs ORDER BY created_at DESC LIMIT 30`,
 sql`SELECT source,mode,count(*) versions,max(available_at) last_success FROM research_evidence GROUP BY source,mode ORDER BY source`,
 sql`SELECT id,title,url,source,mode,domain,available_at,published_at,previous_id FROM research_evidence ORDER BY available_at DESC LIMIT 15`,
 sql`SELECT id,name,health,last_fetch_at,last_ok_at,fail_count FROM sources WHERE enabled ORDER BY name`
 ]);
 const live=process.env.RESEARCH_LIVE_ENABLED==='true'&&config.modelCallsEnabled;
 const networkSafe=!config.allowPrivateNetworkFetch&&!config.egressProxyUrl;
 let hasOfficial=false;
 try {
  const endpoints:unknown=JSON.parse(process.env.RESEARCH_OFFICIAL_ENDPOINTS_JSON??'{}');
  hasOfficial=!!endpoints&&typeof endpoints==='object'&&Object.values(endpoints).some(values=>Array.isArray(values)&&values.some(value=>{
   if(typeof value!=='string')return false;
   try {const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password;}catch{return false;}
  }));
 }catch { /* Invalid configuration must not break the private overview. */ }
 const externalState=(configured:boolean)=>!configured?'not_configured':!live?'disabled':!networkSafe?'network_blocked':'configured';
 const provider=process.env.RESEARCH_PROVIDER;
 const modelConfigured=!!process.env.LLM_MODEL&&!!credential('models','LLM_BASE_URL')&&!!credential('models','LLM_API_KEY');
 const analysis=provider==='fixture'?(process.env.RESEARCH_DEMO_ENABLED==='true'?'fixture':'disabled')
  :provider==='llm'?(modelConfigured?(live?'llm':'disabled'):'not_configured'):'not_configured';
 return {targets,radar,runs,coverage,exploration,sourceHealth,capabilities:{corpus:'configured',officialFetch:externalState(process.env.RESEARCH_FETCH_ENABLED==='true'&&hasOfficial),webSearch:externalState(searchConfigured()),analysis}, timezone:'Pacific/Auckland'};
}
export async function detail(id:string) {
 const [target]=await sql`SELECT * FROM research_targets WHERE id=${id}`;if(!target)return null;
 const [briefs,runs,actions]=await Promise.all([sql`SELECT b.*,r.snapshot->'target' target_snapshot FROM research_briefs b JOIN research_runs r ON b.run_id=r.id WHERE b.target_id=${id} ORDER BY b.created_at DESC`,sql`SELECT * FROM research_runs WHERE target_id=${id} ORDER BY created_at DESC`,sql`SELECT * FROM research_actions WHERE target_id=${id} ORDER BY created_at DESC`]);
 const citedIds=[...new Set(briefs.flatMap(b=>b.input_ids as string[]))];
 const historical=citedIds.length?await sql<Evidence[]>`SELECT * FROM research_evidence WHERE id=ANY(${citedIds}::text[]) ORDER BY available_at DESC`:[];
 const current=await recall(target as Target);
 const evidence=[...new Map([...current,...historical].map(e=>[e.id,e])).values()];
 return {target,briefs,runs,actions,evidence};
}
