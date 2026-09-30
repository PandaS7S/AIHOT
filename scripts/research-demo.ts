// CI-only synthetic flows. No external sources or models are called.
import { sql, closeDb } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { createTarget, ingestEvidence, requestRun, detail } from "@aihot/backend/research/store";
import { executeRun } from "@aihot/backend/research/engine";

const database = new URL(process.env.DATABASE_URL ?? "postgres://unset/unset").pathname.slice(1);
if (!/_(test|ci)$/.test(database)) throw new Error("Synthetic demo requires a throwaway *_test or *_ci database.");
const targetIds: string[] = [];
const evidenceIds: string[] = [];
const evidence = (key: string, title: string, body: string, domain: string, extra = {}) => ({
  title: `[合成演示] ${title}`, url: `https://example.org/research-demo/${key}`, source: "Synthetic demo",
  body, domain, mode: "demo", ...extra,
});
async function put(raw: unknown) {
  const e=await sql.begin(tx => ingestEvidence(raw, {}, tx));
  evidenceIds.push(e.id);
  return e;
}
async function run(id: string) {
  const task = await requestRun(id, "synthetic-demo", false);
  if (!task) throw new Error("Missing demo target");
  await executeRun(String(task.id), true);
  const [state] = await sql`SELECT status FROM research_runs WHERE id=${task.id}`;
  if (state?.status !== "completed") throw new Error(`Demo did not complete: ${state?.status}`);
  const result = await detail(id);
  const latest = result!.briefs[0]!;
  console.log("RESEARCH_DEMO_RESULT " + JSON.stringify({ question: result!.target.question, mode: latest.mode, output: latest.output, history: result!.briefs.length }));
}
try {
  const macro = await createTarget({ question: "合成示例：CPI 修订怎样改变 BTC 研究依据？", domain: "macro", terms: ["demo-cpi"] });
  targetIds.push(macro.id);
  const value = (n: number) => [{ text: "合成 CPI 同比数据", kind: "fact", value: n, unit: "% YoY", period: "2026-08", consensus: null, consensusSource: null }];
  await put(evidence("macro", "CPI 同比初值 3.0%", "demo-cpi：合成同比初值 3.0%，期间 2026-08，未提供市场共识。", "macro", { claims: value(3), publishedAt: "2026-09-10T12:30:00Z", timePrecision: "minute" }));
  await run(macro.id);
  await put(evidence("macro", "CPI 同比修订为 3.1%", "demo-cpi：合成同比修订值 3.1%，期间 2026-08，未提供市场共识。", "macro", { claims: value(3.1), publishedAt: "2026-09-10T12:30:00Z", timePrecision: "minute" }));
  await run(macro.id);

  const policy = await createTarget({ question: "合成示例：政策是否已生效，司法暂停如何改变结论？", domain: "politics", terms: ["demo-policy"] });
  targetIds.push(policy.id);
  for (const [stage, label, text] of [
    ["proposal", "政策提案", "demo-policy：目前只是提案，尚未通过。"],
    ["passed", "政策通过", "demo-policy：已通过，预计未来生效，尚未实际实施。"],
    ["paused", "司法暂停", "demo-policy：法院暂停实施，与声称已生效的报道存在冲突。"],
  ]) await put(evidence(`policy-${stage}`, label!, text!, "politics", { claims: [{ text, kind: stage }] }));
  await run(policy.id);

  const idea = await createTarget({ question: "合成示例：模型降价是否让服务型创业机会成立？", domain: "ideas", terms: ["demo-cost"] });
  targetIds.push(idea.id);
  await put(evidence("ai-price", "厂商模型单价下降", "demo-cost：合成 API 每百万 token 单价下降，但没有给出完整服务交付成本。", "ideas"));
  await put(evidence("ai-labor", "人工审核成本未变", "demo-cost：反例访谈指出人工审核成本未变；买家付费意愿、现有替代和获客成本仍未知。", "ideas"));
  await run(idea.id);
} finally {
  if(targetIds.length) {
    await sql`DELETE FROM research_actions WHERE target_id=ANY(${targetIds}::text[])`;
    await sql`DELETE FROM research_briefs WHERE target_id=ANY(${targetIds}::text[])`;
    await sql`DELETE FROM research_runs WHERE target_id=ANY(${targetIds}::text[])`;
    await sql`DELETE FROM research_targets WHERE id=ANY(${targetIds}::text[])`;
  }
  if(evidenceIds.length)await sql`DELETE FROM research_evidence WHERE id=ANY(${evidenceIds}::text[])`;
  await stopBoss();
  await closeDb();
}
