# 私人研究工作台（开发版本）

入口为 `/admin/research`，复用已有管理员登录。输入问题、公司、资产或 idea 即可建专题，假设可选。工作名 Research Desk 和信源预设都可调整。

每五分钟将采集层文章的当前版本同步到私人证据库，不经过公开 AI 相关性、精选或热度门槛。每次扫描最多 100 篇，研究副本保留正文前 50,000 字符，正文不存在时用摘要或标题；没有扫描到的中间修订不会自动从上游历史归档补齐。专题按领域和关键词召回，匹配关键词的材料优先；最多 60 个候选。这是确定性的有限召回，不是全网、全市场或语义检索。没有专题时也能查看探索资料和来源健康。

研究任务保存输入版本和目标快照，提出缺口与反例检查，执行配置允许的补查，生成带引用的变化简报。旧简报保留旧证据、目标版本和首次取得时间。编辑问题会新建目标版本；确认、修正、忽略与结果反馈追加保存，不自动替使用者改变假设。可导出私人 JSON/Markdown。

## 运行模式

| 配置 | 实际能力 |
|---|---|
| 默认 | 私人资料与专题可管理；分析未配置，不生成虚假成功简报 |
| `RESEARCH_PROVIDER=fixture` 且 `RESEARCH_DEMO_ENABLED=true` | 确定性模拟分析，用于流程演示，不能证明模型判断质量 |
| `RESEARCH_PROVIDER=llm`、`RESEARCH_LIVE_ENABLED=true`、`MODEL_CALLS_ENABLED=true` | 使用已有后端 `default` 模型配置与回执；需要实际 API 凭据 |

聊天中的模型订阅和浏览器权限不会给部署的网站自动提供 API。首期不接券商、不下单，不提供实时市场共识、完整行情或交易胜率。

## 可选来源与主动补查

界面可导入五个可编辑的公开示例源：Fed、BLS CPI、ECB、SEC、Bitcoin Core 发布。它们走已有 RSS 采集器，标为 isolated，不进入公共资讯发布。采集仍受 `COLLECT_ENABLED` 控制。现有 AI 例源也可在“信源”页修改，配置可增加 `researchDomain`（politics/macro/btc/stocks/ai/ideas/unknown）。

候选来源目录于 2026-10-01 核对：[Fed](https://www.federalreserve.gov/feeds/feeds.htm)、[BLS](https://www.bls.gov/feed/)、[ECB](https://www.ecb.europa.eu/home/html/rss.en.html)、[SEC](https://www.sec.gov/about/rss-feeds)、[Bitcoin Core](https://github.com/bitcoin/bitcoin/releases)。SEC feed 本次返回 503，应依实际来源健康判断，不能把目录链接存在当作抓取成功。Bitcoin Core 只覆盖代码发布；不覆盖 BTC 价格、链上和衍生品。SEC 公告也不等于完整财报库。只存 RSS 材料和链接，全文转发默认关闭。

官方补证可设置 `RESEARCH_FETCH_ENABLED=true`、`RESEARCH_OFFICIAL_ENDPOINTS_JSON`，例如 `{"macro":["https://www.federalreserve.gov/feeds/press_all.xml"]}`。只访问操作员明确配置的 HTTPS 地址，最多两处，不自动跟随正文指令或模型给出的链接。

开放搜索采用可配置的后端 gateway：

```
RESEARCH_SEARCH_ENABLED=true
RESEARCH_SEARCH_URL=https://your-approved-search-provider.example/search
RESEARCH_SEARCH_KEY=BACKEND_ONLY_SECRET
RESEARCH_SOURCE_HOSTS=www.federalreserve.gov,www.bls.gov,www.sec.gov
```

请求是 POST JSON `{query,limit:3}`；返回 `{results:[{title,url,snippet,originKey?}]}`，最多五条。默认 gateway 未配置；已有搜索服务如需转换协议，应在可信后端实现此接口。没有内置购买搜索服务的流程。

**仅用户单独填写的“允许公开搜索的关键词”外发**，问题、假设、私人证据正文都不会被放进公开搜索查询。系统用这些词查官方原始资料与反例/暂停/成本线索。仅接收指定 host 的 HTTPS 结果，拒绝内网、metadata、认证 URL 和跳转。搜索片段标为 `snippet_unverified`，不声称已经阅读原文，仍需人工核查。网络补查也需要 live 和 model 调用总开关开启；强制私网访问或 egress 代理配置下拒绝研究外发。

搜索片段与同 URL 原始资料分别保存版本，共享原始出处标识，不用片段替换已取得的正文。官方补证保存取得的原始 HTTP 文本；RSS/XML/HTML 还可能需要解析核查，不能视为已完成结构化金融数据校验。

## 预算、恢复与数据边界

- 一轮最多五次实际外发尝试（最多两次官方读取、两次搜索、一次模型分析）；服务预算也适用。先在同一事务预留调用次数，再外发；已收到的回执复用不重复占额度。
- 每个 HTTP 获取有大小/时限约束，无自动跳转；模型最多 3000 输出 tokens，每篇输入正文最多 4000 字符，并在提示中说明截断。已保存的研究副本保留在证据库和私人导出中；这不等于原站完整正文，副本仍受采集、摘要替代和长度限制。
- 外部源最多按小时刷新；相同目标版本和相同输入在同一刷新窗口复用任务。任务重试保留原输入、回执和剩余预算；未知是否已收费的状态等待人工处理，不盲目重复。
- 调用数是硬上限，**不是美元硬预算**。模型回执保留实际 token 用量；价格/供应商账单未知时不能记为零。接通 live 前还需确认供应商预算和账单上限。
- 研究表没有公共发布投影；研究 API 与页面受会话保护、禁止共享缓存和索引，写入需 CSRF，跨站 Origin 拒绝。首期只有一个管理员权限边界，不承诺多用户隔离。
- 数据缺失、未配置、失败、预算耗尽和取消分别显示。来源最后成功时间/失败次数与证据最后取得时间分开，停止采集不能解释为今日无变化。
- 时间存 UTC，显示默认 Auckland；日期精度与原始时区/时间文本另存。后来才取得的旧资料不倒灌进旧简报。结构校验检查引用 ID 与逐字摘录，不能证明语义支持或因果正确。

## 验证与真实运行剩余项

GitHub 标准 Ubuntu CI 在远端安装依赖、运行类型/构建/数据库/路由/回执测试、synthetic flows、站点和 Docker smoke。私人页面 smoke 通过真实 HTTP 登录访问构建后的页面，检查匿名跳转、缓存/索引头、合成简报引用、导出和公共投影隔离；不等于浏览器交互或视觉验收。本机不需要安装命令或依赖。`node scripts/research-demo.ts` 和 `scripts/research-smoke.ts` 只允许临时 `_test`/`_ci` 数据库，日志中三个场景均为合成数据。

真实持续使用还需要允许长期运行的 API/worker/Postgres 环境、后端模型凭据与明确用量预算；若要全网补查，还需选定搜索 gateway。CI 不是持续托管。上线前确认品牌与条款模板，进行少量 live pilot 的原文核查与费用核对，再用 7–14 天真实使用反馈评价漏项、重复和价值。当前模拟结果只证明工程流程。
