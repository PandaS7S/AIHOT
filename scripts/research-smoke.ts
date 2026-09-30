// Exercise the built web page and its actual HTTP session boundary on a throwaway CI database.
import assert from 'node:assert/strict';
import { sql, closeDb } from '@aihot/backend/db';
import { stopBoss } from '@aihot/backend/jobs/queue';
import { ingestEvidence } from '@aihot/backend/research/store';
import { executeRun } from '@aihot/backend/research/engine';

const database=new URL(process.env.DATABASE_URL??'postgres://unset/unset').pathname.slice(1);
if(!/_(test|ci)$/.test(database))throw new Error('Research smoke requires a throwaway database');
const base='http://127.0.0.1:3000';
const password=process.env.ADMIN_PASSWORD;
if(!password)throw new Error('Research smoke requires the synthetic CI ADMIN_PASSWORD');
let targetId:string|undefined;
let evidenceId:string|undefined;
const question='合成界面验证：私人政策问题与历史引用';
const sourceBody='合成界面证据：这只是提案；没有提供市场共识，不能当作已生效。';
try {
  const anonymous=await fetch(`${base}/admin/research`,{redirect:'manual'});
  assert.ok([302,303].includes(anonymous.status));
  assert.ok(!(await anonymous.text()).includes(question));

  const login=await fetch(`${base}/api/auth/password`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({password,return:'/admin/research'}),redirect:'manual'});
  assert.equal(login.status,303);
  const cookie=login.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie,'synthetic login must create a session');
  const me=await fetch(`${base}/api/admin/me`,{headers:{cookie}});
  assert.equal(me.status,200);
  const principal=await me.json() as {csrf:string};
  const headers={cookie,'content-type':'application/json','x-csrf-token':principal.csrf,origin:base};
  const material=await ingestEvidence({title:'[合成演示] 政策提案',url:'https://example.org/research-smoke/policy',source:'Synthetic web smoke',body:sourceBody,domain:'politics',mode:'demo'});
  evidenceId=material.id;
  const created=await fetch(`${base}/api/admin/research/targets`,{method:'POST',headers,body:JSON.stringify({question,domain:'politics'})});
  assert.equal(created.status,200);
  targetId=(await created.json() as {id:string}).id;
  const [run]=await sql`SELECT id FROM research_runs WHERE target_id=${targetId}`;
  assert.ok(run);
  await executeRun(String(run.id),true);

  const page=await fetch(`${base}/admin/research?target=${targetId}`,{headers:{cookie}});
  assert.equal(page.status,200);
  assert.match(page.headers.get('cache-control')??'',/no-store/);
  assert.match(page.headers.get('x-robots-tag')??'',/noindex/);
  const html=await page.text();
  for(const expected of [question,sourceBody,'演示资料 / 模拟分析','证据账本','相反解释与反例','导出 Markdown'])assert.ok(html.includes(expected),`built research page must render ${expected}`);
  assert.ok(!html.includes(password),'the server credential must not enter rendered HTML');
  const exported=await fetch(`${base}/api/admin/research/targets/${targetId}/export?format=markdown`,{headers:{cookie}});
  assert.equal(exported.status,200);
  assert.ok((await exported.text()).includes(sourceBody));
  const publicResult=await fetch(`${base}/api/v1/items?mode=all&q=${encodeURIComponent(question)}`,{headers:{cookie}});
  const publicData=await publicResult.json() as {items:unknown[]};
  assert.deepEqual(publicData.items,[]);
  console.log('RESEARCH_WEB_SMOKE_PASS: anonymous redirect, real session, private built page, citations, export and empty public projection. Synthetic data only.');
} finally {
  if(targetId) {
    await sql`DELETE FROM research_actions WHERE target_id=${targetId}`;
    await sql`DELETE FROM research_briefs WHERE target_id=${targetId}`;
    await sql`DELETE FROM research_runs WHERE target_id=${targetId}`;
    await sql`DELETE FROM research_targets WHERE id=${targetId}`;
  }
  if(evidenceId)await sql`DELETE FROM research_evidence WHERE id=${evidenceId}`;
  await stopBoss();
  await closeDb();
}
