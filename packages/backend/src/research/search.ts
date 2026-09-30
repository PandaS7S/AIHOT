/** An optional deployment search adapter. It receives ONLY explicitly opted-in public terms.
 * Request: {query,limit}; response: {results:[{title,url,snippet,originKey?}]}.
 * Providers are deployment-controlled, never chosen by source contents or model tool instructions.
 */
import { z } from 'zod';
import { sql, type Db } from '../db.ts';
import { config } from '../config.ts';
import { assertPublicUrl } from '../lib/url.ts';
import { guardedFetch } from '../lib/http-fetch.ts';
import { paidRequest, completeReceipt } from '../providers/receipts.ts';
import type { Evidence, Target } from './schema.ts';
const resultSchema=z.object({results:z.array(z.object({title:z.string().min(1).max(600),url:z.string().url().max(2000),snippet:z.string().min(1).max(10000),originKey:z.string().max(2000).optional()})).max(5)});
export function gapsFor(evidence:Evidence[]):string[] {
 const gaps=['相反解释与独立来源尚需核查'];
 if(evidence.some(e=>e.claims.some(c=>c.value!==null&&!c.consensusSource)))gaps.push('共识预期没有来源');
 if(evidence.some(e=>e.claims.some(c=>c.kind==='proposal'||c.kind==='passed')))gaps.push('生效或司法暂停状态尚需核查');
 if(evidence.some(e=>/成本|pricing|price|cost/i.test(e.body)))gaps.push('总交付成本与现有替代尚需核查');
 return gaps;
}
export function publicQueries(t:Target,evidence:Evidence[]):string[] {
 if(!t.public_terms?.length)return [];
 const terms=t.public_terms.join(' ');
 // No question, hypothesis, evidence body or model-written query is sent outside the corpus.
 return [`${terms} original official source`,`${terms} counter evidence criticism suspension total cost`].map(q=>q.slice(0,300)).slice(0,gapsFor(evidence).length>0?2:1);
}
export function searchConfigured():boolean {
 return process.env.RESEARCH_SEARCH_ENABLED==='true'&&!!process.env.RESEARCH_SEARCH_URL;
}
export async function searchPublic(runId:string,query:string,beforeAttempt?:(db:Db)=>Promise<void>) {
 if(!searchConfigured()||!config.modelCallsEnabled||process.env.RESEARCH_LIVE_ENABLED!=='true')throw new Error('not_configured');
 if(config.allowPrivateNetworkFetch||config.egressProxyUrl)throw new Error('unsafe_network_configuration');
 const endpoint=process.env.RESEARCH_SEARCH_URL!;
 if(new URL(endpoint).protocol!=='https:')throw new Error('unsafe_search_endpoint');
 await assertPublicUrl(endpoint,false,false);
 const r=await paidRequest({beforeAttempt,service:'research-search',purpose:'research-v1',subject:runId,identity:{runId,query,endpoint},requestSummary:{scope:'opted-in-public-terms-only'}},async()=>{
  const response=await guardedFetch(endpoint,{route:'direct',method:'POST',headers:{'content-type':'application/json',...(process.env.RESEARCH_SEARCH_KEY?{authorization:`Bearer ${process.env.RESEARCH_SEARCH_KEY}`}:{})},body:JSON.stringify({query,limit:3}),maxBytes:50000,timeoutMs:15000,maxRedirects:0});
  if(response.status!==200)throw new Error('search_failed');
  return {response:resultSchema.parse(JSON.parse(response.text()))};
 });
 const result=resultSchema.parse(r.response);await completeReceipt(sql,r.receiptId);
 const allowed=(process.env.RESEARCH_SOURCE_HOSTS??'').split(',').map(x=>x.trim()).filter(Boolean);
 const valid=[];
 for(const item of result.results){const url=new URL(item.url);if(url.protocol!=='https:'||url.username||url.password||!allowed.includes(url.hostname))continue;await assertPublicUrl(item.url,false,false);valid.push(item);}
 return {results:valid,receiptId:r.receiptId};
}
