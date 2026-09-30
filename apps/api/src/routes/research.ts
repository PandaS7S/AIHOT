import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '@aihot/backend/config';
import { sql } from '@aihot/backend/db';
import { createTarget, detail, overview, requestRun, saveEvidence, updateTarget } from '@aihot/backend/research/store';
import { adminHandler, type AdminHandler } from './admin-auth.ts';
import { enqueue } from '@aihot/backend/jobs/queue';
import { RESEARCH_QUEUE } from '@aihot/backend/research/store';
import { importResearchSources } from '@aihot/backend/research/presets';
const privateHandler=(fn:AdminHandler)=>adminHandler(async(req,reply,admin)=>{
 reply.header('Cache-Control','private, no-store').header('Vary','Cookie').header('X-Robots-Tag','noindex, nofollow');
 if(req.method!=='GET'&&req.method!=='HEAD'&&req.headers.origin && req.headers.origin!==new URL(config.siteUrl).origin)return reply.code(403).send({error:'forbidden'});
 try{return await fn(req,reply,admin);}catch{return reply.code(400).send({error:'invalid_request'});}
});
export function registerResearch(app:FastifyInstance) {
 app.get('/api/admin/research',privateHandler(async()=>overview()));
 app.post('/api/admin/research/source-presets',privateHandler(async()=>importResearchSources()));
 app.post('/api/admin/research/targets',privateHandler(async(req)=>{const t=await createTarget(req.body);await requestRun(t.id,'new-question');return t;}));
 app.get('/api/admin/research/targets/:id',privateHandler(async(req,reply)=>{const d=await detail((req.params as {id:string}).id);return d??reply.code(404).send({error:'not_found'});}));
 app.post('/api/admin/research/targets/:id/edit',privateHandler(async(req,reply)=>{
 const t=await updateTarget((req.params as {id:string}).id,req.body);
 if(!t)return reply.code(404).send({error:'not_found'});
 await requestRun(t.id,'target-revision');return t;
 }));
 app.post('/api/admin/research/targets/:id/status',privateHandler(async(req,reply)=>{
 const b=z.object({status:z.enum(['active','paused'])}).parse(req.body);
 const [t]=await sql`UPDATE research_targets SET status=${b.status},updated_at=now() WHERE id=${(req.params as {id:string}).id} RETURNING *`;
 if(!t)return reply.code(404).send({error:'not_found'});
 if(b.status==='active')await requestRun(t.id,'resumed');return t;
 }));
 app.post('/api/admin/research/evidence',privateHandler(async(req)=>saveEvidence(req.body)));
 app.post('/api/admin/research/targets/:id/run',privateHandler(async(req,reply)=>{const r=await requestRun((req.params as {id:string}).id);return r??reply.code(404).send({error:'not_found'});}));
 app.post('/api/admin/research/runs/:id/cancel',privateHandler(async(req,reply)=>{
 const [r]=await sql`UPDATE research_runs SET status='cancelled',stop_reason='cancelled',finished_at=now() WHERE id=${(req.params as {id:string}).id} AND status IN ('queued','running') RETURNING id`;
 return r??reply.code(404).send({error:'not_found'});
 }));
 app.post('/api/admin/research/runs/:id/retry',privateHandler(async(req,reply)=>{
 const [r]=await sql`UPDATE research_runs SET status='queued',finished_at=NULL WHERE id=${(req.params as {id:string}).id} AND status IN ('failed','not_configured') AND calls<max_calls RETURNING id`;
 if(!r)return reply.code(409).send({error:'not_retryable'});
 await enqueue(RESEARCH_QUEUE,{runId:r.id},{singletonKey:String(r.id)});return r;
 }));
 app.post('/api/admin/research/targets/:id/actions',privateHandler(async(req,reply)=>{
 const b=z.object({action:z.enum(['confirm','correct','ignore','result']),briefId:z.string().optional(),note:z.string().max(4000).optional()}).parse(req.body);
 const id=(req.params as {id:string}).id;
 const [t]=await sql`SELECT id FROM research_targets WHERE id=${id}`;if(!t)return reply.code(404).send({error:'not_found'});
 if(b.briefId){const [brief]=await sql`SELECT id FROM research_briefs WHERE id=${b.briefId} AND target_id=${id}`;if(!brief)return reply.code(404).send({error:'not_found'});}
 const [a]=await sql`INSERT INTO research_actions(target_id,brief_id,action,note) VALUES(${id},${b.briefId??null},${b.action},${b.note??null}) RETURNING *`;return a;
 }));
 app.get('/api/admin/research/targets/:id/export',privateHandler(async(req,reply)=>{
 const d=await detail((req.params as {id:string}).id);if(!d)return reply.code(404).send({error:'not_found'});
 if((req.query as {format?:string}).format==='markdown') {
 const lines=[`# ${d.target.question}`,'',`假设（可选）：${d.target.hypothesis??'未填写'}`];
 for(const b of d.briefs) {lines.push('',`## ${b.created_at.toISOString()} · ${b.mode}`,JSON.stringify(b.output,null,2));}
 return reply.type('text/markdown; charset=utf-8').header('Content-Disposition','attachment; filename="research.md"').send(lines.join('\n'));
 }
 return reply.header('Content-Disposition','attachment; filename="research.json"').send(d);
 }));
}
