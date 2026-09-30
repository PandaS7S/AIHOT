import { Link, useNavigate, useRevalidator } from "react-router";
import { useEffect, useState } from "react";
import type { Route } from "./+types/research";
import type { ResearchOverview, ResearchDetail, ResearchBrief, ResearchTarget } from "@aihot/contracts/research";
import { adminGet } from "../../lib/admin.server";
import { researchTime as time } from "../../lib/research-time";

export async function loader({ request }: Route.LoaderArgs) {
  const id = new URL(request.url).searchParams.get("target");
  const [overview, me, detail] = await Promise.all([
    adminGet<ResearchOverview>(request, "/api/admin/research"),
    adminGet<{ csrf: string }>(request, "/api/admin/me"),
    id ? adminGet<ResearchDetail>(request, `/api/admin/research/targets/${encodeURIComponent(id)}`) : Promise.resolve(null),
  ]);
  return { overview, me, detail };
}
export const headers: Route.HeadersFunction = () => ({ "Cache-Control": "private, no-store", Vary: "Cookie", "X-Robots-Tag": "noindex, nofollow" });
export const meta: Route.MetaFunction = () => [{ title: "私人研究 · Research Desk（工作名）" }, { name: "robots", content: "noindex, nofollow" }];
const domains = [["unknown", "探索"], ["politics", "政治"], ["macro", "宏观"], ["btc", "BTC"], ["stocks", "美股"], ["ai", "AI"], ["ideas", "创业 idea"]];
const statuses: Record<string, string> = { queued: "排队中", running: "研究中", completed: "已完成", failed: "失败", not_configured: "服务未配置", budget_exhausted: "预算耗尽", cancelled: "已取消", unknown: "请求结果不明，需核对回执" };
const relations: Record<string, string> = { supports: "支持", refutes: "反驳", neutral: "中性", unknown: "无法判断" };
const inputClass = "mt-1 block w-full rounded border border-line bg-surface p-2";
const split = (value: FormDataEntryValue | null) => String(value ?? "").split(/[,，]/).map(s => s.trim()).filter(Boolean);
function formTarget(form: HTMLFormElement) {
  const f = new FormData(form);
  return { question: f.get("question"), domain: f.get("domain"), hypothesis: f.get("hypothesis") || undefined,
    terms: split(f.get("terms")), publicTerms: split(f.get("publicTerms")),
    scope: { region: String(f.get("region") || ""), assets: split(f.get("assets")), horizon: String(f.get("horizon") || ""), invalidation: String(f.get("invalidation") || "") } };
}
function QuestionFields({ target }: { target?: ResearchTarget }) {
  return <>
    <label className="block">问题 / 公司 / 资产 / idea<input className={inputClass} name="question" defaultValue={target?.question} required maxLength={600} /></label>
    <label className="block">领域<select name="domain" defaultValue={target?.domain ?? "unknown"} className={inputClass}>{domains.map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label>
    <details><summary className="cursor-pointer text-sm text-ink-3">研究范围与假设（可选）</summary><div className="mt-3 space-y-3">
      <label className="block">假设<textarea name="hypothesis" defaultValue={target?.hypothesis ?? ""} maxLength={1200} className={inputClass} /></label>
      <label className="block">本地召回关键词（逗号分隔）<input name="terms" defaultValue={target?.terms.join(", ")} maxLength={600} className={inputClass} /></label>
      <label className="block">地区<input name="region" defaultValue={target?.scope?.region} maxLength={80} className={inputClass} /></label>
      <label className="block">关联资产（逗号分隔）<input name="assets" defaultValue={target?.scope?.assets?.join(", ")} maxLength={400} className={inputClass} /></label>
      <label className="block">时间尺度<input name="horizon" defaultValue={target?.scope?.horizon} maxLength={80} className={inputClass} /></label>
      <label className="block">什么证据会使假设失效？<textarea name="invalidation" defaultValue={target?.scope?.invalidation} maxLength={1200} className={inputClass} /></label>
    </div></details>
    <label className="block text-sm">允许公开搜索的关键词（可选；仅此字段会外发）<input name="publicTerms" defaultValue={target?.public_terms.join(", ")} maxLength={300} className={inputClass} /></label>
  </>;
}
function CitedText({ text }: { text: string }) {
  return <>{text.split(/(\[[a-f0-9-]{36}\])/g).map((part,i) => /^\[[a-f0-9-]{36}\]$/.test(part)
    ? <a key={i} className="mx-1 underline text-accent" href={`#evidence-${part.slice(1,-1)}`}>证据</a> : <span key={i}>{part}</span>)}</>;
}
function BriefView({ brief }: { brief: ResearchBrief }) {
  return <article className="my-4 rounded-xl border border-line bg-surface p-5">
    <p className="text-sm text-ink-3">{brief.mode} · {time(brief.created_at)} · 研究版本 {brief.target_version}</p>
    {brief.target_snapshot && <p className="mt-2 text-sm">当时的问题：{brief.target_snapshot.question}</p>}
    <h3 className="mt-3 text-lg font-semibold">相对上次的变化</h3>
    <ul className="mt-2 space-y-2">{brief.output.changes.length ? brief.output.changes.map((s,i) => <li key={i}><CitedText text={s} /></li>) : <li>输入版本没有新增变化；请同时检查来源和任务状态。</li>}</ul>
    {(["findings", "alternatives"] as const).map(k => <section key={k}>
      <h4 className="mt-5 font-semibold">{k === "findings" ? "事实与关联建议" : "相反解释与反例"}</h4>
      {brief.output[k].map((f,i) => <div className="my-3" key={i}>
        <p>{f.text} <small className="text-ink-3">（{relations[f.relation] ?? f.relation} / {f.assumption ? "假设" : "机器建议，待确认"}）</small></p>
        {f.citations.map(c => <blockquote key={c.evidenceId+c.quote} className="mt-2 border-l-2 border-line pl-3 text-sm text-ink-3"><a className="underline" href={`#evidence-${c.evidenceId}`}>查看证据版本</a>：{c.quote}</blockquote>)}
      </div>)}
    </section>)}
    {(["conflicts", "unknowns", "nextChecks"] as const).map(k => <section key={k}>
      <h4 className="mt-4 font-semibold">{{ conflicts: "冲突", unknowns: "未知与覆盖缺口", nextChecks: "下次验证" }[k]}</h4>
      <ul className="mt-2 space-y-2">{brief.output[k].map((s,i) => <li key={i}><CitedText text={s} /></li>)}</ul>
    </section>)}
  </article>;
}
export default function Research({ loaderData }: Route.ComponentProps) {
  const { overview, me, detail } = loaderData;
  const refresh = useRevalidator();
  const navigate = useNavigate();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!overview.runs.some(r => ["queued", "running"].includes(r.status))) return;
    const timer = setInterval(() => refresh.revalidate(), 5000);
    return () => clearInterval(timer);
  }, [overview.runs, refresh]);
  async function post(path: string, body: unknown = {}, selectTarget = false) {
    setBusy(true); setMessage("");
    try {
      const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": me.csrf }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(`操作失败（${res.status}），请检查输入和登录状态。`);
      const result = await res.json() as { id?: string };
      if (selectTarget && result.id) navigate(`?target=${result.id}`);
      await refresh.revalidate();
    } catch (error) { setMessage(error instanceof Error ? error.message : "操作失败"); }
    finally { setBusy(false); }
  }
  const capabilityLabels: Record<string,string> = { corpus: "已接入资料", officialFetch: "官方补证", webSearch: "开放搜索", analysis: "分析" };
  const capability = (value: string) => value === "not_configured" || value === "none" ? "未配置" : value === "disabled" ? "已配置，开关关闭" : value === "network_blocked" ? "网络配置阻止外发" : value === "fixture" ? "模拟分析" : value === "llm" ? "真实模型" : "已接通（仍需实际调用验证）";
  return <div className="mx-auto max-w-5xl px-5 py-8 text-ink">
    <h1 className="text-2xl font-semibold">私人研究工作台</h1>
    <p className="mt-2 text-ink-3">政治、宏观、BTC、美股、AI 与创业 idea。问题即入口，假设可选。时间显示为 Pacific/Auckland。</p>
    <p className="my-4 rounded-lg bg-bg-sunk p-3 text-sm">{Object.entries(overview.capabilities).map(([k,v]) => `${capabilityLabels[k] ?? k}：${capability(v)}`).join(" · ")}。模拟分析用于验证流程。</p>
    {message && <p role="alert" className="my-3 text-hot">{message}</p>}
    <div className="grid gap-8 md:grid-cols-2">
      <section><h2 className="text-xl font-semibold">变化雷达</h2>
        {overview.radar.length ? overview.radar.map(b => <div className="my-3 rounded-lg border border-line p-4" key={b.id}>
          <Link className="font-medium underline" to={`?target=${b.target_id}`}>{b.question}</Link>
          <p className="my-2 text-sm text-ink-3">{b.mode} · {time(b.created_at)}</p>
          <p>{b.output.changes[0]?.replace(/\[[a-f0-9-]{36}\]/g, "") ?? "没有新增输入；请同时检查来源状态。"}</p>
        </div>) : <p className="my-3 text-ink-3">尚无成功简报。下方探索资料不要求先建专题。</p>}
        <h3 className="mt-6 font-semibold">探索资料</h3>
        {overview.exploration.length ? overview.exploration.map(e => <p className="my-3 text-sm" key={e.id}>
          <a className="underline" href={e.url} rel="noreferrer" target="_blank">{e.title}</a><br />
          <span className="text-ink-3">{e.mode === "demo" ? "合成演示" : "接入资料"} · {e.previous_id ? "资料修订" : "首次取得"} {time(e.available_at)}</span>
        </p>) : <p className="my-3 text-sm text-ink-3">尚无资料。可配置已有信源或导入下方示例。</p>}
        <details className="mt-6"><summary className="cursor-pointer font-semibold">来源覆盖与健康</summary>
          <p className="my-3 text-sm text-ink-3">每五分钟检查已接入资料。召回最多 60 个候选；搜索结果片段仍需核查原文。</p>
          <button disabled={busy} className="my-2 rounded border border-line px-3 py-2 text-sm" onClick={() => void post("/api/admin/research/source-presets")}>导入公开示例信源</button>
          <p className="text-xs text-ink-3">Fed、BLS CPI、ECB、SEC、Bitcoin Core 代码发布。示例范围有限，采集受系统开关控制，可在信源页编辑。</p>
          {overview.sourceHealth.map(s => <p className="my-3 text-sm" key={s.id}>{s.name} · {s.health}<br /><span className="text-ink-3">最近抓取 {time(s.last_fetch_at)} · 最近成功 {time(s.last_ok_at)} · 失败 {s.fail_count}</span></p>)}
          {overview.coverage.map(c => <p key={c.source+c.mode} className="my-2 text-xs text-ink-3">{c.source} · {c.mode === "demo" ? "合成演示" : "接入资料"} · {c.versions} 版本 · 最后取得 {time(c.last_success)}</p>)}
        </details>
      </section>
      <section><h2 className="text-xl font-semibold">我的研究</h2>
        <form className="my-4 space-y-4" onSubmit={event => { event.preventDefault(); void post("/api/admin/research/targets", formTarget(event.currentTarget), true); }}>
          <QuestionFields /><button disabled={busy} className="rounded bg-ink px-4 py-2 text-bg">开始研究</button>
        </form>
        {overview.targets.map(t => <p className="my-3" key={t.id}><Link className="underline" to={`?target=${t.id}`}>{t.question}</Link>{t.status === "paused" && <small className="ml-2 text-ink-3">已暂停</small>}</p>)}
      </section>
    </div>
    <section className="mt-8"><h2 className="text-xl font-semibold">任务状态</h2>
      {overview.runs.slice(0,8).map(r => <div key={r.id} className="my-3 rounded border border-line p-3">
        <div className="flex flex-wrap gap-4"><span>{statuses[r.status] ?? r.status} · {r.calls}/{r.max_calls} 次调用</span>
          {["queued", "running"].includes(r.status) && <button disabled={busy} onClick={() => void post(`/api/admin/research/runs/${r.id}/cancel`)}>取消</button>}
          {["failed", "not_configured"].includes(r.status) && <button disabled={busy} onClick={() => void post(`/api/admin/research/runs/${r.id}/retry`)}>重试（保留预算）</button>}
        </div>
        <details className="mt-2 text-xs text-ink-3"><summary className="cursor-pointer">查看执行记录</summary><p>{r.stop_reason ?? "—"}</p>{r.steps.map((s,i) => <p key={i}>{s.step}: {s.status}</p>)}</details>
      </div>)}
    </section>
    {detail && <section className="mt-8 border-t border-line pt-6">
      <h2 className="text-2xl font-semibold">{detail.target.question}</h2>
      <p className="my-2 text-ink-3">可选假设：{detail.target.hypothesis ?? "未填写"}</p>
      <div className="my-4 flex flex-wrap gap-4">
        <button disabled={busy || detail.target.status === "paused"} onClick={() => void post(`/api/admin/research/targets/${detail.target.id}/run`)}>检查新资料</button>
        <button disabled={busy} onClick={() => void post(`/api/admin/research/targets/${detail.target.id}/status`, { status: detail.target.status === "paused" ? "active" : "paused" })}>{detail.target.status === "paused" ? "恢复研究" : "暂停研究"}</button>
        <a className="underline" href={`/api/admin/research/targets/${detail.target.id}/export`}>导出 JSON</a>
        <a className="underline" href={`/api/admin/research/targets/${detail.target.id}/export?format=markdown`}>导出 Markdown</a>
      </div>
      <details className="my-4"><summary className="cursor-pointer">编辑研究问题（保留旧版本）</summary><form key={`${detail.target.id}-${detail.target.version}`} className="mt-4 max-w-xl space-y-4" onSubmit={event => { event.preventDefault(); void post(`/api/admin/research/targets/${detail.target.id}/edit`, formTarget(event.currentTarget)); }}><QuestionFields target={detail.target} /><button disabled={busy} className="rounded border border-line px-4 py-2">保存新版本</button></form></details>
      {detail.briefs.map(b => <div key={b.id}><BriefView brief={b} /><div className="flex flex-wrap gap-4 text-sm">
        {[["confirm", "确认"], ["correct", "修正"], ["ignore", "忽略"], ["result", "追加结果"]].map(([v,l]) => <button disabled={busy} key={v} onClick={() => { const note = window.prompt(`${l}：备注（可选）`); if (note !== null) void post(`/api/admin/research/targets/${detail.target.id}/actions`, { action: v, briefId: b.id, note }); }}>{l}</button>)}
      </div></div>)}
      <h3 className="mt-8 text-xl font-semibold">证据账本（含历史版本）</h3>
      {detail.evidence.map(e => <details id={`evidence-${e.id}`} key={e.id} className="my-3 rounded border border-line p-4">
        <summary className="cursor-pointer">{e.title} · {e.mode === "demo" ? "合成演示" : /^(search-snippet|synthetic-search):/.test(e.source) ? "搜索片段，待核查原文" : "接入资料"}</summary>
        <p className="my-2 text-sm text-ink-3">来源：{e.source}。保存内容可能为摘要或截断副本，请核对原文。</p>
        <a className="my-2 inline-block underline" href={e.url} target="_blank" rel="noreferrer">原文出处</a>
        <p className="text-sm text-ink-3">发布：{time(e.published_at, e.time_precision, e.time_metadata?.publishedRaw)} · 发生：{time(e.occurred_at, e.time_precision)}<br />来源时区：{e.time_metadata?.sourceTimezone ?? "未知"} · 取得：{time(e.available_at)} · 修订自：{e.previous_id?.slice(0,8) ?? "—"}</p>
        <pre className="my-3 whitespace-pre-wrap text-sm">{e.body}</pre>
        {e.claims.map((c,i) => <p className="my-2 text-sm" key={i}>[{c.kind}] {c.text} · 数值 {c.value ?? "未知"} {c.unit ?? ""} / {c.period ?? "期间未知"} · 共识 {c.consensusSource ? c.consensus ?? "未知" : "未知（无来源）"}</p>)}
      </details>)}
      <h3 className="mt-6 font-semibold">反馈与结果</h3>
      {detail.actions.map(a => <p className="my-2 text-sm" key={a.id}>{time(a.created_at)} · {a.action} · {a.note ?? "无备注"}</p>)}
    </section>}
  </div>;
}
