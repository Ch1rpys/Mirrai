# Mirrai `exec/v6` 独立验收报告（2026-11-27 · WP0–WP18 三遍全程）

> **用途**：这是 `docs/exec-v6.md` 那份施工与验收手册在 `exec/v6` 分支上的**独立验收报告**。带实施上下文的实现会话没有参与；验收时严格按手册逐条重跑，不采信进度文件里的证据。本报告是详细版（含每一条的复现、位置、来源与状态结论），进度文件 `docs/exec-v6-progress.md` 的批次日志只保留摘要与状态改动。
>
> **给修复会话**：按本报告的 §1（阻断/高/中）→ §2（逐 WP 的其余发现）→ 附录 A（176 行逐条结论）的顺序修；每修完一条把进度表状态改回并在进度文件批次日志记一行。修复会话的提示词见本报告 §10。
>
> **仓库状态**：分支 `exec/v6`，验收开工 HEAD `f55a94b`，验收结果提交 `1cfaa00`（只改 `docs/exec-v6-progress.md`）。`main` 仍 `f71e77b`；未 push、未合并、未切分支；工作区干净。
>
> **日期**：2026-11-27（Asia/Shanghai）。验收会话没有实施上下文。

## 0. 结论

**不能直接往下走，要先修。** 176 行（164 条建议 + WP0 的 7 条 + WP18 的 5 条）在三遍复核后：**143 行维持原状态（验收清单过），33 行判「没过 / 状态不实」并已改回**——其中 **27 行 ⬜、6 行 🟡**。另有约 20 条「验收清单过但仍有中级问题」的行未降级，修复时一并处理。

严重度：**阻断 1 条、高 3 条、中 30 余条、低若干**。其中约 20 条是能复现的实际代码缺陷（不只是进度文件写错），包括封存后无法解封/删除、WP12 四处安全危机检测缺失、投影幂等性不成立、脱敏原文泄漏、<200 条记录蒸馏丢分析文本、真实库唯一冲突回退失效、材料体检谎报「够」等。

**状态总览（176 行）**：验收前 ✅92 · 🟡81 · ⛔1 · 🔒2 · ⬜0 → 验收后 **✅72 · 🟡74 · ⛔1 · 🔒2 · ⬜27**。

**建议修复顺序**：① 阻断（C6.2）与高（WP12 危机检测、B3.4、C1.7）；② 其余「改 ⬜」的中级功能缺陷；③ 应改 🟡 的状态/证据问题；④ 按工作包修「验收清单过但有中级问题」的行；⑤ 低严重度的文档/证据/测试质量项。

---

## 1. 三遍是怎么验的、开工基线证据

### 1.1 三遍

- **第 1 遍（逐条清单复核）**：把 WP0–WP18 拆成 34 个验收单元（覆盖全部 176 行），逐条重跑手册「验收」清单，读测试源码确认断言真的在测那件事，每单元至少做一次清单外边界；34 个单元并行，报告在 `/tmp/verify/pass1/<单元>.md`。
- **第 2 遍（测试与证据审计）**：另开一批验收员，同一批单元重审「测试与证据本身」：空断言/被 mock 掉/被 skip、进度数字是否虚高/过时、状态诚实性（✅ 是否应为 🟡）、未验证清单命令是否可执行、先红后绿证据；报告在 `/tmp/verify/pass2/<单元>.md`。
- **第 3 遍（完整复核）**：再换一批验收员按「做法 / 边界 / 验收 / 端到端入口」完整复核；前 8 个单元做了深核（含探针/临时库），其余 26 个单元做完整但较轻的复核；报告在 `/tmp/verify/pass3/<单元>.md`。
- 三遍互相独立；本报告取三遍并集，能复现的逐条复现，拿不准的进 §8「存疑」。**只读**：代码与测试一行未改。所有变异/撤修复实验都在 `/tmp` 的 `git archive HEAD` 副本里做。

### 1.2 开工基线（我亲自跑）

- `corepack pnpm gate`（不带 `--fast`、不带 `DATABASE_URL`）退出码 0、`all seven steps passed`；`725` 个文件（`700 passed | 25 skipped`）、`6084` 个用例（`5962 passed | 122 skipped`）。`tsc --noEmit` 退出 0、`audit-cn` = 0、`fidelity-gate` 7 条 ✓、`doc-links` 94 条链接 / 37 个文件全解析。
- 带库：`server/skip-audit.test.ts` 登记的 29 个 DB 测试文件用 `--no-file-parallelism` 顺序跑 = `29 passed (29)` / `134 passed (134)` / **0 skipped**；同批文件无库时 `4 passed | 25 skipped` / `12 passed | 122 skipped`——gate 的 122 个跳过全部对上，没有别的跳过。通过数 5962 > 基线 2486。
- 提交范围（main..exec/v6，684 个提交）：`Co-Authored-By` 0 条、无 merge；`server/wechat/ilink` diff 空；`drizzle/` 相对 main 只有 43 个新增迁移（0044–0086）+ `schema.ts` 修改，旧迁移未动；测试文件 259→725，没有删除/改名（17 处被删 `it(` 逐条核对为改名/重组，等价用例仍在）；黄金快照只有 `e506484` 一个提交且之后未改；新增依赖 14 个全在手册 1.3 白名单，各自单独提交并写明用途。
- 迁移专项（临时库 `mirrai_v6_verify`，用完 `dropdb`）：43/43 迁移有幂等头与 down 段、up 段无 DROP/UPDATE/DELETE；`push`→`migrate` 84 条→`--replay` 84 条→`--rollback 1` 退 0086→`migrate` 回来；整段 43 次 rollback 退到 0043（28 表/40 列/71 索引全部消失、`file_type` 回 5 值），再 43 次 migrate 全部装回；5 条升级路径抽查通过；另建只 `push` 的库与 push+migrate 库做 catalog diff 零差异。
- 先红后绿（我在 `/tmp` 副本里撤修复→红→还原→绿，工作区未动）：`b5e402d` 空串备份口令（旧码 1 failed | 14 passed）、`da7ce1d` 邮件主题换行（1 failed | 11 passed）、`2cfd462` 分身的话不当 TA 的事实（5 failed）、`89d0048` 动作规则精度（12 failed | 8 passed）、`21981ee`/`8614668`/`8ceb9b8` 大厅三项（旧码 9/8/19 failed，报错正是「TA 想对你说」「很想你」「连续对话 2 天」）、`78f2500` 空语料重排只调一次（1 failed）。
- 验收后（提交 `1cfaa00`）再跑一次 gate：仍全绿（同上数字）。临时库全部清理，`mirrai_live` 未写。

### 1.3 报告的来源标记

- **（我复跑）**：本轮验收会话亲自跑过命令/复现的。
- **（验收员实跑）**：第 1/2/3 遍验收员在临时库、副本或纯函数探针上复现过，我核对过复现命令与 file:line 的。
- **（代码可核）**：只做到读代码/读测试确认、没跑端到端的；file:line 可核。

---

# 1. 严重问题（阻断 / 高 / 中）

**阻断**
- [ ] **C6.2（阻断·功能）封存之后，界面上没有任何解封 / 申请提前打开 / 取消申请 / 删除该分身的入口**：服务器白名单（`server/_core/trpc.ts` 的 `SEAL_EXEMPT_PATHS`）确实放行 `persona.seal.*`、`persona.getSettings`、导出、删除，但唯一渲染 `SealSettings` 的两页 `PersonaEdit.tsx:541` 与 `Graduation.tsx:523` 的第一条数据都是 `persona.get`（`PersonaEdit.tsx:107,416-437`、`Graduation.tsx:62,101`），而 `persona.get` 被 `sealedGuard` 挡成 FORBIDDEN；大厅封存卡片（`client/src/pages/Lobby.tsx:1020-1031`）只有名字日期和三句话，没有按钮。净效果：用户一点「封存」，应用里再也解不开、删不掉（只有设置页的「导出/导入分身包」还能导出）。代码里还写着「the controls to lift it are always reachable」（`SealSettings.tsx:6-9`）、文案承诺「随时可以导出或删除」「这三天里可以随时取消」（`zh.ts:3323/3330`）。另外封存分身仍会产出提醒：`server/scheduler/reminders.ts:162` 只查 `remindersEnabled`、没有 `sealState` 判断，纪念日/「那年今天」照片/回访卡照常生成、照常在大厅显示、anniversary 还走推送（`server/db.ts:9780`、`routers.ts:4742`、`Lobby.tsx:489-575`）；纯函数探针：加 `settings.seal.until=2099-01-01` 后仍得到 `["anniversary"]`「今天是「第一次见面」的日子。」以及照片 trigger，与未封存完全相同（C8.2 的信箱路径已过滤封存，提醒这条漏了）。复现（我复跑）：临时库 `drizzle-kit push --force` 后 `appRouter.createCaller` 以主人身份调 `persona.get` → `FORBIDDEN「这个分身封存着…」`，同一时刻 `persona.getSettings` 与 `persona.seal.set({until:null})` 返回 OK。`SealSettings.test.tsx` 4 条只测组件内 mock，测不到「进不去页面」。**状态：C6.2 ✅→⬜。**

**高**
- [ ] **C3.3 / C3.5 / C4.4 / C4.5（高·安全）WP12 总规矩第 2 条「用户输入的任何一句话都先过 `detectCrisis`」在四条用户自由文本入口没有实现，也没有危机用例**：`outbound.addOwn`（`server/routers.ts:7917-7930`）、`outbound.saveOutcome`（`:8036-8060`，note 直接落库并建 `said_it` 关系事件）、`roleplay.end` 的 `note`（`server/routers-v6/roleplay.ts:178-197`）、`journal.create/update`（`server/routers-v6/journal.ts:47,70`）都不调用 `detectCrisis`、不写安全事件、页面不弹危机卡片；这些条目的测试也都没有危机用例（总规矩原文：「每个条目的测试都要有这一条」）。对照同包 C3.2/C3.6/C4.2 等入口已实现。复现（代码可核）：`addOwn`/`saveOutcome` 输入「我不想活了」→ 路由返回成功、`safety_events` 0 行（第 2 遍验收员用真库跑过同样结果）。**状态：C3.3 ✅→⬜、C3.5 ✅→⬜、C4.4 🟡→⬜、C4.5 ✅→⬜。**（C3.4 的粘贴框输入是 TA 的话，按总规矩字面也缺，但语义边界不清，列存疑不降级。）
- [ ] **B3.4（高·验收不成立）投影幂等性在真实可达的指纹组合下不成立**：`punct_width` 排在 `comma_to_space` 之后（`shared/style-projection.ts:19-28,165-167`），全角偏好时把半角 `,` 改成 `，`，第二遍投影时 `comma_to_space` 才把它改成空格 → `projectStyle(projectStyle(x)) ≠ projectStyle(x)`。可复现的真实指纹：221 行「好的 知道了 行吧」类文本 → `spaceAsComma=1、halfWidthRate=0`，`projectStyle("好的,知道了")` 第一次得「好的，知道了」（applied `punct_width`），第二次得「好的 知道了」（applied `comma_to_space`）。另第 3 遍发现 `strip_period` 会把气泡中间的句号也删掉（手册只说删「每个气泡末尾的单个 。/.」，实现按行删所有句号，`shared/style-projection.ts` 的 `stripPeriod`）。手册 B3.4 做法 2 明写「所有规则都是幂等的」；现有 `style-projection.test.ts:301-318` 的 50 句幂等断言在夹具上 0 句会被规则改动，等于空转。**状态：B3.4 🟡→⬜。**
- [ ] **C1.7（高·隐私）脱敏之后 `persona_files.parseReport` 仍存被替换掉的原文，还会回传到浏览器**：同一次 `confirm` 里记录行已脱敏（`server/importers/index.ts:432-434`），但写进 `parseReport` 的 `baseReport.rawTable`（前 8 行原文，column-map）和 `baseReport.speakers[].name`（脱敏前人名）没处理（`server/importers/index.ts:353-371、456-462、489-497`），`getImportStatus`（`:561-576`）把整份报告回给客户端。手册 C1.7 做法 3 加粗要求「库里只存脱敏后的内容。`parseReport` …不记被替换掉的原文」；界面文案承诺「换掉之后找不回来」。复现（我复跑，仓库副本里跑路由测试）：column-map+`redaction.phones` → 记录行是「打 [phone]」而 `REPORT_HAS_PHONE true`；generic-line+`redaction.names:["琪琪"]` → 行 speaker 已是 `[person-1]` 而 `REPORT_HAS_QI true`。现有测试只走 generic-line+phones，抓不到。**状态：C1.7 ✅→⬜。**

**中**
- [ ] **C3.2（中·验收明确项失败 + 做法 3 未接线）`forcedAct` 不是最终裁决，追加指令也没进提示词**：`planTurn` 先把 `sampledAct = input.forcedAct`，紧接着 `if (conflictTurn.forceRepair) sampledAct = "repair"`（`server/chat/generate.ts:353-357`），验收第 2 条「每次模型调用的计划里 `sampledAct` 等于 `forcedAct`」不成立；排练的追加指令塞进 `TurnInput.sceneOverlay`（`routers-v6/rehearsal.ts:274`）但普通 model 分支的 `composeMessages` 根本没有 `sceneOverlay` 参数（`server/chat/generate.ts:585-625`），第二次生成与第一次同 prompt。验收测试把 `planTurn` 整个 mock（`routers.rehearsal.test.ts:121-129,141-143`），两条都测不到。另第 3 遍发现承诺类守卫只覆盖手册列举的部分说法，未覆盖的中英文问句会走「生成三种可能」而不是 `my_side_only`（0 次模型），第二道闸也可能放过替 TA 回答的话。**状态：C3.2 🟡→⬜。**
- [ ] **C3.7（中·验收明确项失败）见面当天入口用 TA 的时区，不是用户的时区**：`Chat.tsx:2216` 给 `MeetDayNote` 传 `persona?.timezone || user?.timezone`（persona 优先），而同页 `MeetCountdown` 是 `user?.timezone ?? persona?.timezone`（`:2223`）。手册 C3.7 验收写「入口只在见面当天出现（…用户时区）」。异地跨日时会错天。**状态：C3.7 ✅→⬜。**
- [ ] **C4.2（中·验收明确项失败）「三次更难受」的缓一缓卡片会未显示就记为已显示，常见场景下永不出现**：`AfterChat` 的 `useEffect` 只看 `data.worse` 就 `acknowledge.mutate`（`client/src/components/v6/AfterChat.tsx:68-72`），而渲染时「待回答」分支提前 return（`:77-103`），卡片在 `:105-123` 才渲染；待回答与 worse 同时为真时（第三次 worse 后第二天很常见）首访只看到提问，卡片没显示却已记为已显示，用户不回答就再也不会出现。**状态：C4.2 ✅→⬜。**
- [ ] **C2.5（中·做法 2/3.4）用户确认过/批注过的转折在记录变化后从心电图里消失**：`buildTimeline` 只把用户决策叠加到「本次重新检出」的转折上（`server/records/timeline.ts:355-369`），某周在新数据里不再够格时，决策还在 `personaData` 但页面看不到。验收只测记录不变的情况。复现（第 1 遍验收员，真库）：确认 2023-W29 并写 note → 删该期间 128 行 → 该点从 `record.timeline` 输出消失。**状态：C2.5 🟡→⬜。**
- [ ] **B1.1（中·做法 10 接缝）1–199 条结构化记录的分身，分析阶段完全不读记录，预估还谎报「会读 N 段」**：`server/routers.ts:675` 把 `chatContent` 改成只剩上传文本（旧码是 `records ? collectedTranscript : ...`，见 `git show 93aa60d^:server/routers.ts:432,458-460`），而 `pipeline.ts:1516` 在 `recordLines < 200` 时走的老分支只读 `chatContent`（`:1543-1555`）→ 分析提示词里是「（暂无聊天记录，请基于已有信息谨慎推断）」；`estimate.ts:134-158` 不判断 200 阈值，上传页仍显示「这次会读 1 段记录…大约调用模型 5 次」，实际 map 调用 0 次。另：导入向导/CLI/采集器登记的是 `chat_export`（`server/importers/upload-route.ts:58`、`scripts/mirrai.ts`），而 `readDistillationMaterial` 只把 `chat_txt`/`chat_csv` 的 `extractedMemory` 当上传文本（`server/routers.ts:633-646`）——所以走导入向导/CLI 的分身即使 1–199 条记录也拿不到任何分析文本（第 3 遍用 120 条记录复现 `HAS-RECORD-LINE: false`）。复现（我复跑 150 条记录的探针）：`ESTIMATE {"chunks":1,...,"calls":5}` / `MAP_CALLS 0` / 分析 user 消息含 noChatBlock。**状态：B1.1 ✅→⬜。**
- [ ] **B5.2（中·数据层）`createReplyJob` 的唯一冲突回退在真实库上失效**：`isPgUniqueViolation` 只看顶层 `error.code`（`server/db.ts:3624-3626`），而 drizzle 0.45 把 pg 错误包成 `DrizzleQueryError`、`code` 在 `error.cause.code`；第二次插入同一 pending 待办会抛异常而不是返回已有任务（我复跑：`THREW: DrizzleQueryError | top-level code: undefined | cause code: 23505`）。调用点 `server/chat/reply-jobs.ts:186-199` 没有 try/catch。测试把 `../db` mock 掉、mock 里自己折叠重复，抓不到。B5.2 已是 🟡（效果未量），问题待修。
- [ ] **B2.1（中·安全清洗）用户这一侧的种子行绕过 `filterHarm`**：手册 B2.1 的清洗规则要求种子行「每一句都要过 `isSafeSeedLine`/`filterHarm`」，第 3 遍发现用户侧的行只过了 `isSafeSeedLine`、没有 `filterHarm`（`shared/seed-turns.ts` / `server/skill-engine/seed-turns.ts` 的选取分支），伤害记录可能以「用户原话」形式进入种子轮次；没有测试、没有偏差记录。
- [ ] **B4.2（中·做法 3 死代码）「示范检索收窄」在主聊天路径未生效**：手册 B4.2 做法 3 要求动作簇收窄示范检索；第 3 遍发现该收窄只接在评测/演练路径，`server/chat/service.ts` 的正常聊天路径没有调用，属死代码；B4.2 已是 🟡，问题待修。
- [ ] **B5.2 / B5.8（中·跨包）延迟回复与「追一句」在 Telegram/Discord/Matrix 通道上退化成 Web 推送，且这批轮次被当成 web 轮次计数**：第 3 遍在 `server/channels/bridge.ts` 与 `server/chat/reply-jobs.ts` 的接线里确认：非 web 通道走 `pushToUser` 而不是通道自身的发送路径，`metadata.channel`/每日轮次统计记成 `web`；手册 B5.8 要求「通道上同一套节奏」、B5.2 做法 4 要求从当前通道发。无测试、无偏差记录。
- [ ] **C4.6（中·做法/时区）关系事件的日期用 UTC，不用用户时区**：`client/src/components/v6/` 的关系时间线把 `at` 直接 `.slice(0,10)`（与 C2.6 同型），用户时区 00:00–07:59 的事件会显示前一天；手册 C4.6 要求按用户时区呈现。
- [ ] **C4.3（中·做法 1）「聊完之后」的趋势陈述没有和之前四周比较**：手册要求四段趋势各比较前后两个四周；实现（`server/_core/health-trends.ts` / C4.3 路由）只给最近四周的数字、没有「之前四周」对照，测试名写了比较但断言没有。C4.3 已是 🟡，问题待修。
- [ ] **⌘K 的「原始记录」组在加载中/失败时仍显示「没找到」**（C2.2/C2.10 的界面状态三态）：加载失败被渲染成「什么都没找到」，违反 3.7「失败不许渲染成什么都没有」。
- [ ] **B1.8（中·做法第 3 步）「点一条原话跳到记录阅读器那一行」在 C2.10 落地后仍未接上**：`EvidenceList.tsx:60-73` 的原话仍是纯文本、没有链接/`?at=<recordId>`；手册 B1.8 做法 3 写明「C2.10 落地之前先不做跳转，只显示」，C2.10 已是 ✅ 且 `Records.tsx:67-81` 支持 `?at`。B1.8 的验收清单本身没列跳转，故不改状态，但做法欠一步。
- [ ] **B6.3（中·做法明确）作息挖掘与提示词用了两只不同的钟**：蒸馏入口把**用户时区**传进流水线（`server/routers.ts:660-664,721-741` → `pipeline.ts:1891`），提示词/主动开口按 **TA 时区优先**（`server/chat/generate.ts:247-251`、`persona-utils.ts:875-881`）；`lifeEvent.mine` 又只用 persona 时区（`routers.ts:7740`）。分身与用户时区不同时，确认的作息永远对不上、静默失效。第 1 遍验收员用探针复现（NY 挖出的窗口在上海时钟下 `currentRoutines=[]`）。**状态：B6.3 🟡→⬜。**
- [ ] **B6.6（中·界面文案）默认开着的「有依据」提示在记忆来源上日期为空：「记录里有（）」**：服务端组装 `memories` 只给 `id/title/description`（`server/chat/service.ts:2903-2907`），客户端 `MessageBubble.tsx:843` 用 `claim.date ?? ""`；实测 `translate("zh","chat.claimSupported",{text:"拾光咖啡",date:""})` → 「「拾光咖啡」— 记录里有（）」。第 3 遍另发现问句识别漏：`fact-check.ts` 只在「吗/是不是」时判问句，以「？」结尾的问句被当成陈述并抽出假声明（探针复现）。**状态：B6.6 🟡→⬜。**
- [ ] **B7.3（中·做法 3/4）语音转写没有进 C2.2 检索；「在记录里看」也没接到阅读器**：`recordText` 会读 `meta.transcript`（`server/db.ts:4992` 注释），但 C2.2 的检索不走 `recordText`（第 1、2 遍各自确认检索不到语音条里说过的话）；`EvidenceList.tsx:60-73` 的原话仍是纯文本，C2.10 的 `?at=<recordId>` 已可用却没用上（`Records.tsx:67-81`）。**状态：B7.3 🟡→⬜。**
- [ ] **B7.11（中·做法 3）截图校对页的时间列按 UTC 显示、编辑后按浏览器时区重新解释，时刻整体偏移**：`client/src/components/v6/ScreenshotImport.tsx:214-226` 用 `row.at.slice(0,16)` 塞 `datetime-local`，改动后 `new Date(value).toISOString()`；上海用户看到 12:30 显示成 04:30，改一下变成前一天 20:31Z（我复算：`'2024-06-01T04:31'` → `2024-05-31T20:31:00.000Z`）。现有测试不改时间字段，测不到。**状态：B7.11 🟡→⬜。**
- [ ] **B7.14（中·做法）打断时已经开始的合成不会中止，音频在 `interrupt-ack` 之后仍会发出并播放**：`server/chat/call.ts:298-299,372-443,479-484` 的 `interrupt` 只置标志、不取消正在进行的 `generateTTS`；客户端对任何二进制帧无条件 `playAudio`。手册 4252「收到 interrupt 就中止这一轮的生成和还没发出去的合成」。**状态：B7.14 🟡→⬜。**
- [ ] **B7.5（中·mock 与真实不符）`silenceRatio` 的 `tailSec` 在真 ffmpeg 上恒为 0，验收测试的 mock 与真实 ffmpeg 输出不符**：`server/_core/ffmpeg.ts` 解析 `silencedetect` 只认带 `silence_end` 的行，真 ffmpeg 尾部静音没有 `silence_end`（第 2 遍验收员用真 ffmpeg 复核）；`ffmpeg.test.ts` 的 mock 输出与真实输出不同，验收成了假绿。B7.5 保持 🟡（听感未验），问题待修。
- [ ] **B8.2（中·功能）「朋友来测」的邀请链接在 UI 流程里必然失效；盲测理由进候选队列指向错对象**：邀请按钮只在 `summary` 后出现（`client/src/pages/BlindTest.tsx:169-195`），而 summary 只在整场答完时出现（`:89-92`）；`blind.invite` 照样把 token 写进已完成的场次（`server/routers-v6/blind.ts:255-267`），访客路由对 `finishedAt` 非空的场次直接 NOT_FOUND（`:102-111,269-278`）→ `/blind/:token` 永远 404，且 `blind.invite` 没有任何测试。理由统计把 `caseId`（标答下标）当 `messageId` 写进候选（`server/eval/blind.ts:232`），`fidelity.confirm` 又不认盲测行（`routers.ts:7317-7326`），候选看得到确认不了。**状态：B8.2 🟡→⬜。**
- [ ] **B8.4（中·面板谎报成本）`eval.auditionInfo` 在「有记录、未存过标答」时报 0 道题 0 次调用，点下去实际现切 60 条**：`routers.ts:6864-6877` 只用 `getEvalCases` 的存储标答算成本，`:6911-6915` 的 `audition` 在没有存储标答时会 `buildEvalCases` 现切一套（第 2 遍验收员在临时库复现：`{cases:0,calls:0}`，真实会切 60 条、约 60 次调用/模型）。组件测试把 `{cases:12,calls:24}` 直接 mock 掉。另有第 3 遍发现的第二个问题：实际不可达的候选模型仍被正常评分（`server/eval/run.ts:366-373` 失败 case 静默跳过、只有 `metrics.cases===0` 才标 error，`audition.ts:208-214`），固定回法样本让一个 58/60 调用失败的 provider 也能拿分甚至排第一（stub 复现：Ollama 0.375 / OpenAI -0.375）。**状态：B8.4 🟡→⬜。**
- [ ] **B8.5（中·验收明确项失败）`--ablate` 在 `--yes` 之前就发起了一次模型调用**：`scripts/eval-run.ts:299` 在 `if (ablate)`（:472）和 `if (!yes)`（:487）之前就 `labelEvalCases`，缺动作标注的标答会先打一次 provider；验收要求「没有 `--yes` 时不调用模型，只打印预估」。第 1 遍验收员用桩模型复现（打印预估前 `POST /v1/chat/completions` 1 次）。**状态：B8.5 🟡→⬜。**
- [ ] **B8.10（中·报表失真）材料体检的「分状态统计」把非文本行也算进去，会报「够了」而 B3.1 的 `perState` 根本量不出来**：`server/db.ts:11447-11462` 的 `emotionRows` 只过滤 `role='assistant'` 和 emotion 非空、没有 `kind='text'`；而 `measureFingerprint` 只对文本行算 `perState`（`shared/style-fingerprint.ts:689,698-708`）。第 2 遍验收员在临时库造「5 状态各 20 条文本 + warm 20 条表情包」→ 报表 `perState.ok:true, have:20`，但 `measureFingerprint` 的 `perState` 里没有 warm。**状态：B8.10 ✅→⬜。**
- [ ] **C7.1（中·状态诚实性）悼念守则的模型层效果未量，状态应为 🟡 且未验证清单缺行**：C7.1 的 `memorialGuard` 是提示词层，模型是否真的不声称「在那边」、不替真人承诺，本机没有非 stub provider 可量（同批 C7.3/C4.1 这类都已是 🟡）；未验证清单里也没有 C7.1 行。**状态：C7.1 ✅→🟡。**
- [ ] **C7.4（中·状态诚实性）真实模型从真实口述抽取、真实录音转写、两账号浏览器链路都未量，却标 ✅**：未验证清单里 C7.4 已有三行（`progress:102-104`）明确写「本机没有非 stub 的模型/麦克风」；按手册 1.4 最高只能 🟡。**状态：C7.4 ✅→🟡。**
- [ ] **B1.4 / B1.5（中·状态诚实性）动作/情绪标注的准确率需要真实模型才能量，标成了 ✅**：两条的验收只用「返回真值」的 mock 验证覆盖度/桶结构；真实模型对言语动作、六态的标注准确率没有量、也没有未验证行。且第 2 遍验收员发现「标签写回 DB」的路径没有任何测试（`updateRecordLabels` 全仓测试零命中；所有直接测试都 `write:false`），「同一批第二次 0 调用」只在内存数组上证明。**状态：B1.4 ✅→🟡、B1.5 ✅→🟡。**
- [ ] **B3.5 / B3.6（中·状态诚实性）手册 WP5 开头写明「每条做完标 🟡」，这两条标了 ✅ 且未验证清单缺行**：WP5 开头原文「效果怎么样你量不了——每条做完标 🟡，并把 `pnpm eval --compare <层> --k 3` 写进未验证清单」（`docs/exec-v6.md:2290`）。B3.5 的候选质量、B3.6 的草稿像不像，都要真实记录才能判断。**状态：B3.5 ✅→🟡、B3.6 ✅→🟡。**另 B3.6 有一个实际缺陷：贴纸草稿读的是不存在的 `stickers[state]` / `stickers.perState[state]`（`shared/imperfection-draft.ts:336-350`），真实形状是 `stickerStats.byState[state].rate`（`shared/sticker-stats.ts:44-46`），「不发表情包」草稿永远产不出来。
- [ ] **C9.8（中·安全段明确要求）群里的消息没有计入用户当天的使用量**：手册 6350「群里的消息计入用户当天的使用量」；`server/group/reply.ts` 与 `server/routers-v6/group.ts` 里没有任何 `incrementChatCount` / 用量账本调用（代码可核），群聊也不写 `messages`，所以这部分开销对预算/用量面板不可见。**状态：C9.8 🟡→⬜。**
- [ ] **C10.1（中·手册明文「不进任何导出」）伤害报告的证据片段进了 JSON 数据导出**：`server/_core/export-data.ts:223` 把 `personaData` 原样放进 bundle，`harmReport.snippets`（`server/skill-engine/harm.ts:97-102`）随之被 `exportAsJson` 序列化；第 2 遍验收员实测带 snippets 的 bundle 导出 JSON 含原话 true、Markdown false。手册 1685「证据片段只在这张卡片里给用户看（最多 3 条），不进任何导出」。另 `soften`（「学语气，不学这些话」）在全仓测试里零覆盖（只有一行注释）；第 3 遍还发现**首次蒸馏时伤害过滤不生效**：`pipeline.ts:1604` 先算 `harmReport`，`:1929` 的 `measureStyleProfile` 从库里读的仍是旧 personaData（`:2245` 才提交），于是首次蒸馏写出的风格样本/动作原话簇/冲突冷话可能带伤人原话（探针：`personaData={}` 时 samplePool 泄漏 3 句，带「decision: remove」时 0 句），要等下一次导入/蒸馏才纠正。**状态：C10.1 ✅→⬜。**另：阅读器搜索 / ⌘K / C2.3 面板里 C10.1 标出的伤人话没有默认折起（`WP11a` 第 2 遍，中）。
- [ ] **C10.6（中·做法「生成路径上所有读 styleProfile 的地方改成读 effectiveStyleProfile」有一处绕过）二选一特征仍读被停用的指纹/判别器**：`server/chat/service.ts:1913` 的 `fingerprintFromPersona(persona)` 在 `server/eval/ab-pairs.ts:137-150` 里直接 `normalizeStyleProfile(persona.styleProfile)`，不读 `settings.disabledProfiles`；用户开了「偶尔让我二选一」并停用「指纹/判别器」后，该轮二选一的排序特征仍来自停用的画像。第 3 遍只读探针确认：`effectiveStyleProfile(persona).fingerprint === null` 而 `fingerprintFromPersona(persona)` 仍返回完整指纹。结构测试只扫字面量 `persona.styleProfile`，扫不到这种函数式间接读。**状态：C10.6 ✅→⬜。**
- [ ] **C8.11（中·功能）删置顶消息→再置顶→撤销后，可见置顶变成 4 条**：第 2 遍验收员复现的置顶计数/可见性错乱（`server/routers.ts` 的 message-marks 路由与撤销恢复组合）；C8.11 现有测试只测「撤销后消息回来」，没测置顶计数。**状态：C8.11 ✅→⬜。**
- [ ] **C7.2（中·做法 4/界面承诺）撤销共用后，家人删不掉自己那一行分身**：手册 C7.2 做法 4「撤销或主人删除分身：家人的那一行还在（他的对话是他的，可以导出、删除）」；第 2 遍验收员在真库复现删不掉（路由对 shared/revoked 分身的删除路径没有放行），界面文案「你在这里的对话还在，可以导出或删除」不兑现。**状态：C7.2 ✅→⬜。**
- [ ] **（中·证据）未验证清单里大量 `pnpm eval --compare <层>` 命令不可执行**：`scripts/eval-run.ts:100/195` 的 `--compare` 是布尔（固定 default vs withoutRules/withoutAct/withoutRerank 三路，`:648-757`），不接受层名；B3.3–B3.8、B4.x、B6.x、B8.8 等十余行未验证清单写的是「`--compare fingerprintRerank` / `--compare <层>`」，照抄跑不到那一层（第 2 遍 4 个单元各自独立发现）。应改成 `--without <层>` 配合已保存运行，或明确 `--ablate`。另外 B2.1 验收写的 `--without seedTurns` 也不是有效层名（`shared/layers.ts` 里叫 `seededTurns`），按字面跑会静默无效。
- [ ] **（中·证据）P18.4 的边界覆盖按字面不足**：进度文件与摘要称「38 条 ✅ 条目逐条试了清单没写到的边界」，但当时 ✅ 有 91–92 条；「38」实际是抽样/必查集里的 ✅ 数。且边界小节只列了 35 个编号（结论段另补 C1.5/C1.7），B3.5 全篇无记录 → 可核 37/38。口径收窄没有记偏差。**状态：P18.4 维持 ✅（其验收只查名单/结论/问题处理），但证据要更正；若按手册字面「对每一条 ✅」则 P18.4 的做法未完成。**
- [ ] **（中·证据）进度文件关键数字不实/过时（一批）**：摘要写「共 604 条偏差」，实际偏差表 609 条（1–609 无缺号）；偏差 603 写「落后 101 个提交」，实际 `git rev-list --count origin/exec/v6..HEAD` = 114；C7.1 行写 `graduation-mode.test.ts` 8 通过，实际该文件自创建起就是 6 条；P18.5 行写发布说明 27634 字节，实际 `211743e` 时 27646、HEAD 28085；roadmap P18.1 行写 6081 用例而进度表 P18.1 行是 6080；摘要说 P18.4 有「4 条环境/健壮性观察」而正文是 3 条；P18.1 日志把「文档站导航」记到 `395162f` 实际是 `36f4c68`。另进度表约 20 处「N 通过」已被后续提交推高（B4.1 9→10、B6.1 term-match 5→4、C6.6 farewell 12→9、C8.8 a11y 13→19、B7.1/B7.2/B7.6、C7.1、C7.3、C3.1 等），有多处是在被引提交上就不成立（C6.6/C7.1/B7.6）。这些不改变代码行为，但按 1.4「证据」口径必须订正。
- [ ] **（中·证据）迁移条目的进度证据有三处写错**：`progress:1266`（A1 必查证据）写「push → migrate 84 → `--rollback 1`（0045 的 5 列 + persona_files 2 列 + file_type 枚举消失）」——journal=84 时 rollback 1 退的是 0086；要退 0045 须先回滚 42 条。`progress:1319` 写 0046「messages 4 列」，实际 4 列（act/actSource/emotion/emotionSource）加在 `collected_messages`（`drizzle/0046_distillation_tables.sql:56-59`）。`progress:403`（C9.8）写 0085「三个索引」，实际 7 个（`drizzle/0085_group_chat.sql:24,35,37,39,53,55,57`）。另有 5 处索引计数口径不一致。
- [ ] **（中·测试隔离）`PROMPT_LAYOUT=cache` 会让黄金快照测试红**：`server/chat/prompt-golden.test.ts` 与 `server/farewell.test.ts` 没有把布局钉成 classic（`server/_core/persona-utils.ts:396` 读进程环境）；设 `PROMPT_LAYOUT=cache` 跑分别 9 failed / 1 failed（第 2 遍验收员复跑）。开发者/用户机器上配过这个变量，闸门就会报与代码无关的红。应在这两个测试里固定环境或显式还原。
- [ ] **（中·测试质量）B2.9 / B7.6 / C8.3 / C8.13 / C1.8 / B7.3 / C7.3 / C10.2 / C3.1 / C4.3 等条目的证据里点名了不存在或没有断言该事的测试**：如 `B7.6` 写 `tts.test.ts` 19 通过（从未到过 19）、`C8.13` 声称的两条测试不存在、`C1.8` 的 InterviewView「说话、转写先给人看」实际是空 mock、`B7.3` 拿 `Voices.test.tsx` 当「日期/谁发」的证据但测试没断言、`C8.3` 「旧代码+新测试红 2 条」在当前框架下复现不出、`C7.3`「收藏」只测了取消收藏、`C4.3` 四条趋势里「聊完之后的回答」没有前后比较。「被测逻辑整个 mock 掉」的典型：`routers.milestones.test.ts:74-84` 把 `getUserMilestones` 整个 mock（「只统计当前用户」是 mock 定义的），`routers.rehearsal.test.ts` mock `planTurn` 使 `sampledAct===forcedAct` 从未被测，`pipeline-v5-seam.test.ts:226-238` 名为「structured records」的用例仍带 `chatContent`（掐掉结构化路径后套件仍绿）。这些条目验收清单字面多数仍过，但证据/覆盖要补。
- [ ] **（中·测试质量）`B5.2/B5.7` 的「到点」进程内定时器路径没有测试、`B5.5` 组件测试用了服务端不会发送的 payload 形状（`typingMs` 长 = 文本数−1 的生产分支无测试）**（第 2 遍验收员）。
- [ ] **（中·状态诚实性/证据）B7.5 真 ffmpeg 上 `tailSec` 恒 0、B8.4 成本谎报、B8.10 报表失真已列在上面单独条目；另 `B8.8/B8.3` 的未验证判定/漂移命令不可执行或会把全失败当「没漂」**：`server/eval/drift.ts:163-225` 每轮异常只 `console.warn`，全部失败时 `windows: []` 仍打印「the voice stayed inside the first window」并 exit 0（第 2 遍验收员复现）。

# 2. 按工作包的其余发现（第 1/2/3 遍汇总）

> 这里列的是三遍复核里除 §1 已详述之外的发现；每条都指到 file:line 或进度文件行号。严重度括号内标注。

## WP0
- （低）P0.4 的 `StyleProfile` 仍留 `discriminator?: unknown` / `rerankWeights?: unknown` 占位，B8.1/B8.8 落地时没有按「各条目落地时替换」改成具体类型，也没记偏差：`shared/style-profile.ts:82,112`、手册 `docs/exec-v6.md:807`。
- （低）P0.4「别人的分身返回 NOT_FOUND」的测试没有区分力：mock 让 `getPersonaById` 恒返回 undefined，测不到路由是否传了 `ctx.user.id`：`server/routers.persona-settings.test.ts:60-66`。
- （低）P0.5 追一句被改成「人呐」，与手册 §3.5 的「人呢」不同；偏差 191 已记录（理由是手册又要求「从不用呢」），不是隐藏问题，但取证时要知道夹具按「人呐」断。
- （低）P0.5 回复间隔断言偏宽：evening median ∈ (25,60)、daytime ∈ (80,180)，设计值 40/120；实测 41/116。`server/test-fixtures/xiaoman.test.ts:384-389`。
- （低）P0.5 性能断言 `<2000ms` 而非验收的 `<500ms`（偏差 190 已记；实测 81–105ms 满足 500ms）。
- （低）P0.2 验收文字写「六步」而 gate 是七步（P18.1 加的 doc-links）；偏差 596 已记。
- （存疑）P0.3「把任意一句提示词改一个字测试红」在最终树上字面不成立：v6 专用 key 不影响黄金快照，只有老分身提示词的句子会红。

## WP1
- （低）C1.6 删来源文件时没有删该文件导入的 `stickers` 行（`server/db.ts` 的 deletePersonaFile 只清 records/media/memory_media/persona_files）；与 B7.1「表情图复制一份，删来源之后库还在」（手册 3945）的设计冲突，但未登记偏差。
- （低）C1.3 做法 3「归档媒体相对路径写进 `meta.path`」没有测试：`server/importers/normalize.ts:440-452`（`attachMediaPaths`），全仓测试 grep 无命中。
- （低）C1.2 的 `needs_chat` 状态在 WP1 验收时没有组件测试（`ImportWizard.test.tsx` 当时只有 5 条，补测在 2026-11-19 的 `214d5bc`）；历史证据不完整，现在已覆盖。
- （低）C1.2 做法 2/3 的「按列对应」面板没有渲染测试：`client/src/components/v6/ImportWizard.tsx:561`（`ColumnMapPanel`）只测了入口按钮存在。
- （低）A3 的 `csv-not-unlabelled.test.ts` 直接调 importer + guessRoles/assignRoles，没有走上传路径、没有查库；偏差 40 只登记了「先红后绿」，没登记这一点。
- （低）A1 验收 2「同一秒两条相同内容」没有一条「真库 + 真写路径」的测试：两半分别是手搓 key 的唯一索引测试（`db-records.test.ts:55-99`）与 mock 掉写入的 `db-store.test.ts:505-527`。
- （低）C1.1 的 `column-map` 没有出处链接；README 全部用英文 `Checked 2026-11-16 against …`（语义等价）。
- （中·测试质量）A4/A2 验收第 2 条「records 路径」实际没被隔离测试：`pipeline-v5-seam.test.ts:226-238` 第二用例仍带 `baseInput.chatContent`，把结构化路径掐掉整个 skill-engine 套件仍绿（第 2 遍复跑）。
- （低）A4 进度行拿 `toTimedTranscript` 当证据，但它在 B1.1 接入后已无生产调用者（只剩自身单测）。
- （低）C1.7 缺少「勾名字 / 走 column-map 之后检查最终 parseReport 不含原文」的测试——这正是 §1 高问题的来源。

## WP2
- （中低）上锁的分身仍可能被「接着聊 / 今日话题 / 快捷栏」推出来：`client/src/lib/lobby-eligibility.ts:23-31` 的 `mayFeature` 不看 `locked`，`persona.list` 对锁定行只清 name/avatar/personaData/settings；结果大厅里会出现空白名字的推荐。C8.4 的集成缺口。
- （中·测试质量）`server/routers.milestones.test.ts:74-84` 把 `getUserMilestones` 整个 mock（「只统计当前用户」是 mock 定义的），手册点名的这个文件测不到真实过滤；真实 SQL 由 `db-behaviour.test.ts:988-1010` 与第 2 遍真库探针覆盖。
- （低）`db-behaviour` 的「一条 DISTINCT ON 取最新关系事件」用例只有 1 个分身 1 条事件，断言不含查询次数/`happenedAt desc`/reconciliation 反转。
- （低）A6 进度行的提交列漏了 `94f72d2`（快捷栏 mayFeature + 新增用例），且把 14/15/16 三个提交点的数字混在一行。
- （低）偏差 134 说「已有路由测试和 db-behaviour 还在用它们」，实际路由测试没有用 `listFromPersona`/`keepFromPersona`（只有 db helper 的测试）。
- （存疑）`PersonaConstellation` 仍用旧 filter（`Lobby.tsx:762`）；`Analytics.tsx:340` 仍有「分身互动排名」——「拿掉对话排行」是否覆盖这两处取决于读法。

## WP3
- （中·测试质量）B1.4/B1.5 的「标签写回 DB」路径没有任何测试：`pipeline.ts:1906,1918` 用 `write:true`，但 `label-acts.ts:180-197`/`label-emotions.ts:114-129` 的 `updateRecordLabels` 在测试 db mock 里没有导出，所有直接测试都 `write:false`；「第二次蒸馏 0 调用」只在内存数组上证明。
- （中·安全）C10.1 的 `soften`（「学语气，不学这些话」）零覆盖：全仓测试除一行注释外没有 `soften`；过滤语义 `shared/harm.ts:251-254`、路由枚举 `routers.ts:2252-2255`。
- （低）`persona-utils-harm.test.ts:45-48` 的「在围栏之外」断言空转：它循环找 `MATERIAL>>>`，而系统提示词的围栏是 `<persona_data>`，探针实测 887 字符里 "MATERIAL" 出现 0 次。
- （低）B1.5 的规则分支 `decideByRule` 零测试：`label-emotions.ts:66-91`（触发词≥2、多数态、平局）没有任何用例走规则分支。
- （低）B1.1「所有块的行数之和 == 文本行数」被弱化成 id 集合完整：`chunks.test.ts:61-76`；偏差 188 有解释，但夹具上等号其实成立，可以同时保留。
- （低）B1.1 的 estimate 与实际切块在英文 locale 下不一致：estimate 路由不传 locale（`routers.ts:5183-5197`）→ 英语用户看到 22 段/30 次，实际 23 段/31 次（第 2 遍探针）；`MAX_DISTILL_CALLS` 也按偏低值卡。
- （低）B1.1 上限测试只断 `rejects.toThrow(/上限/)`，没断验收要求的 `BAD_REQUEST`（`routers.skill-engine.test.ts:308-322` vs `routers.ts:556-565`）。
- （低）B1.1/B1.3 名为「引用另一个块的行号」的用例用的是不存在的 id（`pipeline-chunked.test.ts:398-413,559-581`、`facts.test.ts:75-90`），只证明「不在本块」，不证明「跨块」。
- （低）B1.2 的「主要情绪」分层在首次蒸馏时用不上：情绪标注在 `pipeline.ts:1911` 才写回，而切块/抽样在 `:1480-1519`。
- （低）B1.3 的 `MAX_FACTS_PER_RUN=1000` 实际是「每次抽取调用」上限，管线对私有/公开/书面各调一次，一次蒸馏理论上可新增 ~3000 条（`facts.ts:27,369-375`、`pipeline.ts:2001-2105`）。
- （低）C10.1「已选 keep 重跑仍是 keep」的证据是单元级 `mergeUserDecisions` 测试（`pipeline-decisions.test.ts:327-339`），不是真正重跑管线。
- （低）进度表 B1.1 行 256–260 的「N 通过」与 HEAD 不符（chunks 6→11、pipeline-chunked 7→15、facts 8→15 等）。

## WP4
- （低）B8.6 是「最接近 🟡 降级线」的 ✅：它的问题陈述（真实模型两次跑差 0.02 以上的概率 42%）只能靠真实模型量，验收只证明自助法/三结论/k 次的机制；是否改 🟡 见存疑。
- （低）B8.10 做法 4（README 指向上传页「材料够不够」表）没做：`README.md:1006` 仍是旧句。
- （低）B8.10 进度行数字过时：`theirs` 3332→实际 3334、前 30 行 `need-have` 15→16；`--ablate` 11 runs/660 calls→实际 12 runs/720 calls/11 层（B9.3 加了 logitBias）。
- （低）B8.8 的 `fidelity_pairs` 多一行只有 mock 断言，没有真库插入测试；未验证清单的 `--compare fingerprintRerank` 命令不可执行（见 §1 证据类）。
- （低）B8.3 漂移测量在模型全部失败时仍打印「voice stayed inside the first window」并 exit 0：`server/eval/drift.ts:163-225`、`scripts/eval-run.ts:404-413`（第 2 遍复跑）；「写库 helper 0 次」的断言排除了 `insertLlmUsage`。
- （低）B8.4 做法「任何一个失败就记下原因继续」没落到结果：provider 真实报错被 `console.warn` 丢弃，结果里是固定文案（`audition.test.ts:148` 断言的正是那句文案）。
- （低）B3.2 `lineSurprise` 的长度分母用 `max(1, p90−median, median−p10)`，与手册公式 `max(1, p90−median)` 不一致：`shared/style-fingerprint.ts:973,984-1005`。
- （低）B8.5 的 `compare-cli.test.ts` 用源码字符串断言（`expect(src).toContain("if (!yes)")`），锁不住「--ablate 提前调模型」。

## WP5
- （低）B3.8 称呼挖掘有误报（琪琪），测试不锁「只有两个 them_to_me」：`address-history.test.ts:38-52`；行末呼语规则也没有名字/常用词过滤。
- （低）B3.7 去碎片会留下被丢弃长词里的 2 字碎片；送模型的例句数与手册（每词 2 条）不同（实现最多 3 条、全数送）：`shared/lexicon.ts:324`、`server/skill-engine/lexicon.ts:73-82`。
- （低）B3.3 做法的 `metadata.rerank` 接线在、无测试；缓存 LRU 淘汰无测试；「第二次调用不再读数据库」字面不成立（仍查一次版本），偏差表没有行。
- （低）B3.4 的 4 条规则缺「不该动的地方没动」用例；夹具组合例断言比手册松（`style-projection.test.ts:290` 用 `哈{2,}`，设计是 4 连）；测试手写的 `exclaimRuns: [0,0,10]` 编码与真实测量相反（0-based），正是 §1 高问题没被测到的原因。
- （低）WP5 六行的「提交」列只写初版提交，2026-11-19 的修复提交（`6f108a3`/`4271806`/`c4ca7a9`/`f231fef`/`b833c9d`）只在行尾附言/批次日志里。

## WP6
- （中）B2.1 用户侧种子行绕过 `filterHarm`（手册清洗规则要求每一句都过）：选取分支只过了 `isSafeSeedLine`，没调 `filterHarm`；无测试、无偏差（第 3 遍）。
- （低）B2.1 进度行证据与当前测试/夹具不符，验收项 2 字面未满足；B2.1 验收写的 `--without seedTurns` 不是有效层名（`shared/layers.ts` 叫 `seededTurns`）。
- （低）B2.3 未选时期时 `periodMatch` 记 1，与手册「不存在时那一项对所有候选都记 0」不符，且无测试/偏差。
- （低）B2.8 工具回复路径不吃分身采样参数；B2.9「两类内部相对顺序与 classic 相同」断言不全且实际存在重排；Ollama `repeat_penalty` 的「上限 2」没有测试，进度行写成已验证。
- （低）WP6 5 行进度数字与 HEAD 不一致（过时，非高报）。

## WP7
- （中）B4.2 做法 3 的「示范检索收窄」在主聊天路径未生效（死代码）：只接在评测/演练路径，`server/chat/service.ts` 正常聊天没调用。
- （低）B4.1 验收第 2 条「设计值 ±0.08/±0.1」没有独立设计值（是真空带）；B4.6「场景时长/收尾比例」口径与手册不一致，偏差表没记。
- （低）B4.3 衰减测试名说「提示词用新状态」，实际只断言落库；运行时未按「样本不够就跳过」检查 `DYNAMICS_MIN_TRANSITIONS`。
- （低）B4.7「在减法段的围栏内」只断言围栏内外、没断言段内位置；空 pattern 的 `multi_point` 候选在界面上无法确认。
- （低）`conflicts.test.ts` 的「同一 seed 抽同一时长」是恒真测试；进度表行 283 的测试数 9 实际 10；B4.1–B4.7 的 `--compare <层>` 命令不可执行（见 §1）。

## WP8
- （中·证据）B6.5 验收第 4 条的 Chat 头部提示只用「源码正则」证明挂载，拦不住它要拦的回归；测试文件里没有真实挂载断言。
- （中）B6.3 的时区不一致见 §1；B6.6 的空日期/问句识别见 §1。
- （低）B6.1 进度行 `term-match.test.ts` 写 5 通过，实际 4（从未是 5）；B6.2 写 5 实际 7；偏差 142「小满 TA 文本行约 1400，不到 2000」在 HEAD 不成立。
- （低）B6.6 进度数字过时（fact-check 5→9）；候选区分测试区分不了「四选一」与「少生成候选+触发重写」；service 用例名说「先流出再写 claims」但断言不含顺序；实现把「后台核查」做成 done 之前同步等待。
- （低）B6.7 手动记忆的 people 自动填充没走 term-match，单字别名会在普通词里误命中。
- （低）B6.1/B6.2/B6.4 的未验证清单核查命令不是有效 CLI（见 §1）。

## WP9
- （中·测试缺口）B5.2/B5.7 的「到点」进程内定时器路径没有测试（只有带库/路由层）；B5.5 组件测试用了服务端不会发送的 payload 形状，`typingMs` 长 = 文本数−1 的生产分支无测试。
- （低）B5.2 busy 的断言只可能证明「封顶」，证明不了「窗口结束+延迟」；`timingEnabled`/`asyncDelivery` 关的两条没有对应排队测试；认领失效窗口代码 15 分钟 vs 手册 5 分钟（偏差 543 已记？未见行，需核对）。
- （低）B5.6 撤回落库断言是 `includes("[recall]")`，不是 `content === "[recall]"`，也没断言 `metadata.kind`。
- （低）B5.8 通道入口没有 WP9 总规矩要求的危机/弱信号/难过用例；桥的 `deferred → null`、burst 的 `gapsMs` 转发、微信上游逐条发送三条做法无测试。
- （低）进度表 292/296/298 行的提交哈希漏掉后续修复提交。

## WP10
- （中·证据）B7.6 行写 `tts.test.ts` 19 通过（从未到过 19）；B7.3 行拿 `Voices.test.tsx` 当「日期/谁发」的证据，但测试没断言这两项；B7.2 验收「原有断言不改」是空条件。
- （中）B7.5 的 `tailSec` 在真 ffmpeg 上恒 0（mock 与真实输出不符）见 §1。
- （低）B7.6 做法 4「其他引擎下音色选择器隐藏」没有测试；`chat.voices` 无服务端测试；`off` 的错误句子被改过、测试只锁前缀；未验证行没给「起应用」命令。
- （低）B7.2/B7.6 的 whisper.cpp / `hasFfmpeg` 子进程继承完整服务端环境，未用 `subprocessEnvironment()` 清洗（手册 3870）。
- （低）B7.8 人脸聚类只扫相册前 40 张（`MAX_FACE_PHOTOS=40`，相册可返回 200 张），偏差表没记；客户端出站白名单按文件、不是按每一处 `https://`。
- （低）B7.11 无时间条时不可解析的居中系统提示会占掉一分钟（`screenshot-merge.ts:242-254`）。
- （低）B7.12 群聊只用了 `publicFingerprint`，没用 `publicVoice`；B7.14 的「一通最长 60 分钟」「allowedOrigins」分支没有测试；B7.15 气泡最大宽度没实现、背景图路由缺「只读共享分身」守卫（`routers.ts:1660-1704` 无 `assertPersonaWritable`）。
- （低）B7.1/B7.2/B7.6 进度证据的测试条数与当前实际不符。

## WP11
- （中）C10.1 标出的伤人话在阅读器搜索/⌘K/C2.3 面板没有默认折起（第 2 遍）；⌘K「原始记录」组加载中/失败仍显示「没找到」（第 3 遍）。
- （中存疑）C8.7「一轮普通对话里不应该再有任何一次全量读记录」在开了 rerank 的分身上不成立（第 2 遍；存疑已记录但未修）。
- （中）C8.6 清单「假的嵌入函数下『沙滩』能搜到『海边』」只测了排序纯函数，没测 `searchRecordsSemantic`。
- （低）C2.6 与 C2.4/C2.5/C2.7/C2.8 的页面日期用 UTC ISO `.slice`，上海 00:00–07:59 的记录显示早一天；C2.9 说明书把分身名字双重转义；C2.8 无名无坐标的 location 行被归成 `?, ?`；C2.1 闰年 2/28 会带出 2/29 的记录。
- （低）C2.10 的 `?at` 只测高亮不测视口内；「delete 只能删自己的」没有 DB 层测试；C2.2 清单说「路由测试」但断言落在 DB helper；C8.6 10 万行性能数字没写清是否 ANALYZE；C8.7「旧路径结果与改动前相同」只测「走旧路径」；C2.3 similar 分支与 MessageBubble 入口没测试。
- （低）C2.10/C2.2 的提交粒度与手册不一致且无偏差；`shared/copy/v6-report.test.ts` 没扫 C2.3 的 `chat.said*` 文案键；加密账号单字查询静默返回空、界面显示「没找到」。

## WP12
- （中·证据）C3.1 进度行证据数字错（下午 n=5 → 实际 354）；时区回落修复没有回归测试、没有「旧代码上红过」记录。
- （中·i18n）C3.5 的 `said_it` 没有进 `shared/user-side.ts:66` 的 `RELATIONSHIP_EVENT_KINDS`，关系时间线会显示原始键名；`{{name}}` 在两个调用点都不传，生产里显示「TA」。
- （中·测试质量）C4.4 的两条验收只做了「源码正则/被 mock 掉」，不是清单要求的调用计数与示范来源；C4.4 的 self prompt 材料缺「我的称呼习惯」。
- （中·证据）C4.3「聊完之后」的趋势陈述没有和之前四周比较（做法 1 未做到）；C4.3/C4.6「来了几次」实现成「天数」（手册文案是「次」），上一轮验收标成已修但只修了深夜占比。
- （中·做法）C3.2 承诺类问题的守卫只覆盖手册列举的一部分说法；未覆盖的中英文问句会走「生成三种可能」而不是 `my_side_only`，第二道闸也可能放过替 TA 回答的话。
- （中·时区）C4.6 关系事件日期用 UTC 不用用户时区（同 C2.6 型）。
- （低）C3.5/C3.6 的「关系事件存在/库里没变/保持原值」只在 mock 上断言调用参数；C3.3 抽屉里「自己写一句」没有在抽屉里测；C3.6 数字校验只认 ASCII；C3.7 的 `letter.setDone` 把给人看的错误文案写死在服务端；C4.5 的 `entryDate` 是 `varchar(10)` 不是 `date`；C4.2 的 14 天窗口/安全事件去重只断言参数；C4.1 的 `exampleIds` 无断言、`mirror` 只验 2/5 字段、测量→存储→读取链路无测试；C4.6 摘要静默截断、提交粒度与手册不符。
- （低）进度表 5 行证据在 2026-11-20 的验收修复后没有更新，部分事实已错。

## WP13
- （中·证据）C6.2 做法 6「封存时提示可开静态加密」未实现、偏差表没记；C6.5 回访提醒 `kind: "graduation_revisit_7"` 实际写法不同、没记偏差；C6.4 的偏差 300 已被后续实现推翻没更新；C6.6 行写 `farewell.test.ts` 12 通过实际 9；C6.6「四张卡都出现」被记在只断言了标题和两张卡的测试上。
- （中·安全）C5.3 到期时的危机检查只覆盖 message 分支，letter/capsule 分支没有再跑 `detectCrisis`。
- （低）C5.2 的日出日落时区城市 bug（正午显示日出）、天气开关文案显示「TA」、Open-Meteo 证据链自相矛盾；C5.3 全局信箱没有取消入口、用户主动取消显示「那天不能聊」；C5.1 顶栏倒计时 <640px 被隐藏无移动端替代；C5.4 状态切回来的摘要页没测试；C5.5 正文「末尾」只测 `toContain`、数据库密码不是明文只测 mock。
- （低）C7.2 撤销后家人删不掉自己那一行（§1）；chat.getHistory/导出仍可用的验收子项没测试；令牌过期只测 preview 没测 accept；C7.3「收藏」只测取消收藏，新增收藏分支无测试；C7.1 的 `.memorial` 界面变体没实现；C7.4 路由测试把抽取器整体 mock。

## WP14
- （中·证据）C8.13 进度表声称的两条测试不存在、ScenePanel 的「range 徽标」没测；C1.8 的 InterviewView「说话、转写先给人看」实际是空 mock；C8.3「旧代码+新测试红 2 条」在当前框架下复现不出；C8.11 点名了不存在的组件测试；C8.11「结构测试扫 83 处读取」与实际扫描数不符。
- （中）C8.5 验收第 2 条只扫 20/24 个加密列（`diary_entries.highlights/quotes/emotionalArc`、`persona_versions.styleProfile` 没进原始 SQL 扫描），进度表把 24 写成 20；6 个 sweep 里只有 2 个有行为测试、4 个是源码含字符串。
- （中·功能）C8.11 删置顶→再置顶→撤销后可见置顶 4 条（§1）。
- （低）C8.9 诊断探针不写用量账本（偏差 347 未列这条路径）；C8.10 菜单文案与手册不同；C8.12 5 万文件上限只测展示；C8.4 counter 回退用例把被测逻辑 mock 掉；C8.14 a11y 清单漏 5 个新组件、zh-Hant 在服务端多条文案路径回落简体、英文情绪触发词 `\bsad` 缺尾边界；C8.13「shared/scene-range.test.ts」括号说明不精确；C8.8 `sw-privacy` 测试名与断言相反、`pwa-copy` 断言近空转、a11y 13→19、Swift 命令需 `-parse-as-library`（偏差 434 已记）。
- （低）带 `DATABASE_URL` 并行跑 DB 测试会互相死锁，而 CI 正是并行跑的。

## WP15
- （中·证据）C9.5 行引用了不存在的测试文件、把 4904 条/字节数挂到 `bundle-db.test.ts` 上；C9.3 的 `mcp.test.ts` 计数被自己的最后修复改写后没更新。
- （中·功能）C9.5 不带记录的分身包导入后，`keptQuotes` 在应用读取路径被丢弃（`normalizeKeptQuotes` 要求 recordId 是数字，`null` 整条丢）——手册说「文字还在」。
- （低）C9.2 请求体解析失败时错误不是 OpenAI 形状；C9.3 加密锁着时那段「每个工具返回文本开头加说明」不成立、`search_records` 的 `role` 映射没测；C9.4 的 JSON 模式四个调用点只测了事实卡、provider 不支持工具的分支与界面开关没测、未验证命令不可执行；C9.5 的 a11y 计数少 1、size 规则没测、截断包测试只断「抛出 Error」、导入失败后 uploads 留空目录、导出区文案没写「里面有真人的聊天记录」；C9.6 把字符数当字节数（154314 vs 237316）、`--json` 都能 parse 与 doctor 非零退出缺直接测试；C9.7 声称 a11y 覆盖插件面板但实际没有可测控件；C9.8 的「4 个写库调用次数 0」只剩源码文本扫描、开关说明从「最多两次」改成「四次」偏差 532 未同步、代码注释仍说两次、两条验收点名的测试文件与实际证据位置不一致。
- （低）C9.1 进度行数字与协议描述与 HEAD 不符、未被任何附注订正。

## WP16
- （低）C10.2 验收第 4 条「对原有测试每一句正例再断言一遍」缺 1 句（`我很累，也不想活了`），进度证据写「57 条」也少算 1；手册要求记偏差表的「不训练分类器」没有进偏差表。
- （低）C10.6 朗读（TTS）路径直接读 `persona.styleProfile` 的韵律测量（另一处绕过 `effectiveStyleProfile`，§1 是 abPairs 那处）；C10.7 burst 气泡只有最后一条立刻有 provenance；C10.2「提交三个」实际两个未登记；进度表 WP16 两处测试计数过时。

## WP17
- （低）B9.3 的 `shapeGrammar` 只拦个位数列表符号：`12. ` / `10、` / `10）` 开头的行仍能通过（手册要求每行不以数字加点开头）；`shared/llm/grammar.ts`。

## WP18
- （中·证据）P18.4 的「38 条边界」按字面只覆盖当时 92 条 ✅ 中的 38 条，且边界小节只列 35 个编号（结论段另补 C1.5/C1.7）、B3.5 无记录（可核 37/38）；口径收窄没记偏差。
- （低）P18.1 的 README 功能列表漏了 A8、A9、C1.4、C3.7 四个用户可见的 ✅ 条目；P18.1 日志把「文档站导航」记到 `395162f` 实际是 `36f4c68`；roadmap 写 P18.1 6081 用例而进度表是 6080；摘要说 P18.4 有「4 条环境/健壮性观察」而正文是 3 条。
- （低）P18.2 验收第 4 条「`mirrai_live` 从头到尾没有被连接过」按字面不成立（偏差 600 自认清理后为取证多跑了一次只读 `pg_stat_database` 查询）；是否按字面降级见存疑。
- （低）P18.5 发布说明写 27634 字节（`211743e` 时 27646、HEAD 28085）；摘要里 117 行未验证清单被 9 处空行切成 10 段表格、待用户决定 2 处同理。
- （低）偏差表：「共 604 条」实际 609 条；偏差 603 写「落后 101 个提交」实际 114；163 条 `- [x]` 问题行没有提交号；B7.7（⛔）提交与证据为空；进度表/偏差表/未验证清单/摘要里多处未转义 `|` 会错列；`docs/HANDOFF.md` §四 仍是 732 提交/145 文件/1793 用例（main 上就过时，本阶段只改了 Node 句）。
- （低）迁移条目的进度证据三处写错：`progress:1266` 写「rollback 1 退 0045 的列」，实际退 0086；`progress:1319` 写 0046「messages 4 列」，实际加在 `collected_messages`；`progress:403` 写 0085「三个索引」，实际 7 个；另有 5 处索引计数口径不一致。

---

# 3. 低严重度问题（合并清单，不逐条改状态）

> 这些不单独改条目状态，但要和中级问题一起修；每条都有 file:line 或进度文件行号。

- 进度表/批次日志里 163 条 `- [x]` 问题行没有提交号（与 P0.1 要求不符）；B7.7（⛔）提交与证据为空；偏差 300 已被后续实现推翻未更新；偏差 134/300 等若干措辞已过时。
- 表格渲染：进度表/偏差表/未验证清单/摘要里有多处未转义的 `|`（进度表按简单切分有 150+ 行、偏差表 11 行、未验证清单 1 行），GFM 下会错列；摘要「未验证清单」还被 9 处空行切成 10 段表格（待用户决定 2 处同理）。
- P0.5 性能断言是 `<2000ms` 而验收写 500ms（偏差 190 已记，实测 81–105ms 满足 500ms）；P0.4 的 `discriminator?: unknown` / `rerankWeights?: unknown` 占位没有在 B8.1/B8.8 落地时替换（无偏差记录）。
- A1 验收第 3 条与 `routers.file-upload-import.test.ts:99` 的断言相反（文件写在 C1.2 边界之前；偏差 605 已记，四列由 db-store 测试 + import confirm 覆盖）；A1 验收第 4 条、A3/C1.2 验收第 3 条的「先红后绿」没有做到（偏差 27/40 已记）；C1.1 的样本覆盖缺口（wechat-csv 的 video/location/file/transfer/redpacket/music 等 6 类没有样本或断言）与 `wechat-json` 无出处链接；C1.2 点名的 `server/routers.import.test.ts` 不存在（实际 `routers-v6/import.test.ts`）。
- P18.1 的 README 功能列表漏了 A8、A9、C1.4、C3.7 四个用户可见的 ✅ 条目（`README.md`/`README.en.md` 关键词检索 0 命中），与做法 1「补上这一阶段状态是 ✅/🟡 的功能」不完全一致（验收 4 项仍过）。
- P18.2 验收第 4 条「`mirrai_live` 从头到尾没有被连接过」按字面不成立：批次日志/偏差 600 自认清理后为取证多跑了一次只读 `pg_stat_database` 查询（`xact_commit` +1）；P18.2 的核心七步冒烟证据在，是否按字面降级留给用户定（列存疑）。
- 未验证清单与偏差表遗漏：C10.2 的「不训练分类器」没有进偏差表；C4.3/C4.4 的「次/天」「换个位置」文案偏差未登记；C6.5 的 `kind: "graduation_revisit_7"` 实际写法不同未登记；C4.5 的 `user_journal.entryDate` 是 `varchar(10)` 不是 `date` 未登记；C8.9 的诊断探针不写用量账本、C8.10 菜单文案、B1.8 原话跳转、C3.2 的 `.memorial` 等若干未登记偏差。
- 文档命令不可直接复现：C8.8 验收的 `swiftc scripts/macos/MirraiMenu.swift` 需加 `-parse-as-library`（偏差 434 已记）；C9.6 证据把字符数当字节数（154314 vs 实际 237316 字节）。
- 界面/日期类低问题（可核）：C2.6 与 C2.4/C2.5/C2.7/C2.8 的页面日期用 UTC ISO `.slice`，上海 00:00–07:59 的记录显示早一天；C2.9 说明书把分身名字双重转义；C2.8 无名无坐标的 location 行被归成 `?, ?`；C2.1 闰年 2/28 会带出 2/29 的记录；C5.1 顶栏倒计时在 <640px 被 `hidden sm:inline` 隐藏且无移动端替代；C5.3 全局信箱没有取消入口、用户主动取消时显示「那天不能聊」；C6.3 分享版不重置已勾选照片；C7.1 的 `.memorial` 界面变体没实现；C8.14 部分服务端文案在 zh-Hant 下回落简体。
- 其它行为低问题：B3.6 贴纸草稿形状错（已列状态）；B6.6 引号里任何短语都被当地点；B6.7 手动记忆的 people 不走 term-match；B7.8 人脸聚类只扫前 40 张；B7.15 背景图路由缺「只读共享分身」守卫；C6.3 分享版照片默认不为空；C9.5 不带记录的包导入后 keptQuotes 文字在读取路径被丢弃；C5.3 取消语义错误；C8.9 诊断探针不记账本；B4.1 等进度证据测试数过时；B1.8 原话跳转在 C2.10 落地后仍未接。
- 结论：低问题不逐条改状态，留给实现会话按优先级处理。

# 4. 状态改动（本轮）
- ✅→⬜（14）：C6.2、C1.7、C6.3、C3.3、C3.5、C4.5、C3.7、C4.2、B1.1、C10.1、B8.10、C8.11、C7.2、C10.6
- ✅→🟡（6）：C7.1、C7.4、B1.4、B1.5、B3.5、B3.6
- 🟡→⬜（13）：C3.2、C4.4、C2.5、B3.4、B7.3、B7.11、B7.14、B8.2、B8.5、B8.4、B6.3、B6.6、C9.8
- 复核后计数：✅ 92→72、🟡 81→74、⬜ 0→27、⛔ 1、🔒 2（合计 176）。

# 5. 没验到 / 验不了
- 真实模型/真实记录上的效果（更像 TA、AUC、盲测命中率、真实延迟/听感、真实通道/账号）本机没有非 stub provider，未量；仍见未验证清单。
- 真实浏览器交互（拖拽上传、盲测页面、打印样式）本机无浏览器自动化；用 jsdom 组件测试 + 真实 tRPC 调用 + 桩模型替代。
- 历史提交上的测试数与闸门不能倒回重跑（只读约束下不改工作区）；只核了当前 HEAD 的实测数字与提交时间线。
- 远端陈旧 `origin/exec/v6` 是谁在 11-22 推的无法确认；本会话没有 push、没有删除它。

# 6. 存疑（未下结论，未据此降级）
- C3.4 的粘贴框输入用户贴的是 TA 的话，WP12 总规矩「用户输入」是否覆盖它，语义边界不清；未降级。
- B6.7/B6.8 是确定性检索/遗忘权重，按 WP5 那样的「每条标 🟡」不适用；但生成侧效果未量，是否应 🟡 未定。
- P18.2 的 `mirrai_live` 只读连接按手册 1.3「不要写」并不违规、按 P18.2 验收字面「没有被连接过」不成立，降不降级留给用户。
- B6.7/B6.8/C2.6 与 progress-audit 给的 ✅→🟡 候选清单不完全一致，本轮不改。

# 7. 给修复会话的建议（按顺序）

1. **先修阻断/高**：C6.2（封存入口）、WP12 的四处 `detectCrisis`、B3.4（幂等/投影）、C1.7（parseReport 泄漏）。每条单独提交，提交前全量 gate 绿。
2. **再修中级功能缺陷**（改 ⬜ 的其余条目）：C6.3、C3.2、C3.7、C4.2、C2.5、B1.1、B5.2（数据层）、B6.3、B6.6、B7.3、B7.5、B7.11、B7.14、B8.2、B8.4、B8.5、B8.10、C8.11、C7.2、C9.8、C10.1、C10.6、B2.1、B4.2、B5.2/B5.8 通道问题、C4.3/C4.6、⌘K、B1.8。
3. **再处理 ✅→🟡 的状态/未验证清单**（C7.1、C7.4、B1.4、B1.5、B3.5、B3.6）：不是代码缺陷的要补未验证清单（缺什么/命令/谁跑），效果可机器量但有测试缺口的补测试。
4. **再处理「验收清单过但有中级问题」的行**（附录 A 标 `*` 的条目）：补测试、补偏差、补接线。
5. **最后处理低严重度与证据问题**（§3）：进度文件数字、迁移证据、表格转义、README、偏差表、未验证清单命令（`--compare <层>` 不可执行的那批改成 `--without`/`--ablate` 可执行形式）等。
6. 每修完一条：把进度表状态改回（或改 🟡），在批次日志记一段；**不要改 `docs/exec-v6.md` 的正文**（除非用户拍板）；不要为了过闸门删测试/放宽断言/加 skip；黄金快照不许变；数据库改动先在临时库 `mirrai_v6_verify_<名字>` 按 §2.3 四步验，用完 `dropdb`，绝不写 `mirrai_live`。
7. 全部修完后从「三遍验收」的角度重跑一遍本次报告里能复现的证据（gate、DB 全量、迁移四步、§1 里的复现命令），并更新摘要计数。

# 8. 验收产物与复现资产（本机）

- 本报告：`docs/exec-v6-acceptance-2026-11-27.md`。
- 进度文件摘要与状态改动：`docs/exec-v6-progress.md` 批次日志「独立验收 · 2026-11-27 · WP0–WP18 三遍全程复核」（提交 `1cfaa00`）。
- 三遍逐单元报告（含每条命令/输出）：`/tmp/verify/pass1/<单元>.md`、`/tmp/verify/pass2/<单元>.md`、`/tmp/verify/pass3/<单元>.md`（34 个单元；单元定义见 `/tmp/verify/units.json`）。
- 汇总数据：`/tmp/verify/pass1-problems.json`（第 1 遍 83 条结构化问题）、`/tmp/verify/pass1-summary.md`、`/tmp/verify/pass2-summary.md`。
- 本轮 gate 日志：`/tmp/gate-root.log`（开工）、`/tmp/gate-final.log`（提交后）。
- 先红后绿的仓库副本与探针在 `/tmp/verify/rg/`、`/tmp/verify/pass1/`、`/tmp/verify/pass2/`、`/tmp/verify/pass3/probes/`（临时文件，不要在修复提交里引用）。
- 注意：`/tmp` 下的东西可能在重启后消失；如果修复会话要复现，报告里每条都写了命令与 file:line，可以照着重跑。

# 9. 验收边界（哪些不算本轮失败）

- 真实模型/真实记录上的效果（更像 TA、AUC、盲测命中率、真实延迟/听感、真实通道/账号）本机没有非 stub provider，未量；这些仍应保持 🟡 并留在未验证清单里，修复会话不要为了把它们改 ✅ 而编数字。
- 真实浏览器交互（拖拽上传、盲测页面、打印样式）本机无浏览器自动化；已用 jsdom 组件测试 + 真实 tRPC 调用 + 桩模型替代。
- 历史提交上的测试数与闸门不能倒回重跑（只读约束下不改工作区）；只核了当前 HEAD 的实测数字与提交时间线。
- 远端陈旧的 `origin/exec/v6`（2026-11-22）是谁推的无法确认；本会话没有 push、没有删除它。

# 10. 给下一个会话的提示词（可直接复制）

```
你在 /Users/ch1rpy/Desktop/Mirrai 工作，分支 exec/v6。这是 Mirrai 第六阶段（v6）的**修复会话**：先读文档再动手，按严重度修，不要重做验收。

## 先读（按顺序）
1. `docs/exec-v6-acceptance-2026-11-27.md`：2026-11-27 的独立验收报告，含 176 行的结论、每条问题的复现与 file:line、修复顺序建议。
2. `docs/exec-v6-progress.md` 批次日志「独立验收 · 2026-11-27 · WP0–WP18 三遍全程复核」：摘要、55 条 `- [ ]` 问题、状态改动（✅72 · 🟡74 · ⬜27）。
3. 只读相关段落：`docs/exec-v6.md` 第 0–4 节 + 你要修的条目所在的工作包一节（手册 6800 行，别整份读）。

## 目标
把验收报告里的问题修掉。顺序：阻断/高 → 中级（改 ⬜ 的条目）→ ✅→🟡 的状态/未验证清单 → 「验收清单过但有中级问题」→ 低级证据/文档项。**不要跳过阻断/高去修低级项。**

## 硬规则（和实现会话相同）
- 分支 `exec/v6`：不 push、不合并、不切分支；不用 `git add -A`/`git add .`、`git stash`、`git reset --hard`、`git clean`、不改写历史。只 `git add <具体文件>`。
- 每个提交之前必须全绿：`corepack pnpm gate`（不带 `--fast`）。不许为了过闸门删测试、放宽断言、加 skip；黄金快照 `server/chat/__snapshots__/prompt-golden.test.ts.snap` 不许变。
- 提交信息用一句英文陈述句（照仓库风格），**不要 Co-Authored-By**（`git config core.hooksPath .githooks` 先确认）。
- 数据库：只用临时库 `mirrai_v6_verify_<名字>`，按手册 §2.3 四步验，用完 `dropdb`；**绝不碰 `mirrai_live`**。
- 测试：先红后绿。修已有问题（🔧/缺陷）时先写一条在旧代码上会红的测试并确认红，再改代码；不要在测试里 mock 掉被测逻辑、不要只断言调用次数、不要空断言。
- 提示词围栏、文案双语、copy key 必须真的被读到、新迁移幂等 + down 段：都按手册 §1.3/§3.x。
- 每修好一条：把进度表该行状态改回（✅ 或 🟡；🟡 必须在未验证清单里有对应行、写缺什么/命令/谁跑），在批次日志记一行（改了什么、提交号、怎么验的）；效果需要真实模型/真实记录才能量的条目**最高只能标 🟡**，不许填没跑出来的数字。
- 修正手册/进度文件里报告指出的错误证据（数字、迁移描述、`--compare <层>` 不可执行的命令、表格未转义 `|` 等）；不要改 `docs/exec-v6.md` 的正文（除非用户拍板）。

## 建议的批次（每批一个或几个提交）
1. C6.2 封存入口（含封存分身提醒泄漏）；WP12 四处 `detectCrisis`；B3.4 幂等/`strip_period`；C1.7 `parseReport` 泄漏。
2. B1.1（1–199 条记录分析 + estimate 一致性）；B5.2（唯一冲突 cause 链）；B6.3（时区统一）；B6.6（空日期 + 问句识别）；B7.3/B7.5/B7.11/B7.14；B8.2/B8.4/B8.5/B8.10；C8.11 置顶；C7.2 撤销后删除；C9.8 群消息用量；C10.1 snippets 导出/首次蒸馏过滤；C10.6 abPairs 绕过；B2.1 用户侧 seed 清洗；B4.2 死代码；B5.2/B5.8 通道 deferred；C4.3/C4.6 日期与趋势；B1.8 跳转；C3.2/C3.7/C4.2/C2.5 等。
3. ✅→🟡 的六条：补未验证清单行/补测试。
4. 附录 A 标 `*` 的「验收清单过但有中级问题」行。
5. 低级证据/文档项（逐文件清理）。

## 验收方法
- 每条修完，重跑验收报告里该条写的复现命令；跑不通 = 没修好。必要时重跑该工作包的点名测试文件。
- 全部修完后：`corepack pnpm gate` 全绿；带 `DATABASE_URL` 顺序跑 skip-audit 登记的 29 个 DB 文件（0 跳过）；迁移四步 + 整段回滚/装回；把进度文件摘要的状态计数更新到最新。
- 结束时 `git status --porcelain` 必须为空；报告：修了哪些条目、每条的提交号与证据、仍没修的与原因、新的状态计数。

## 注意
- `/tmp/verify/pass1|pass2|pass3/*.md` 是验收时的逐单元报告（含命令/输出），可以当复现清单用，但提交里不要引用 `/tmp` 路径。
- 真实模型/真实记录的效果问题不要试图在本机「修」成 ✅；保持 🟡 并写清未验证命令（`--without <层>` 可用、`--compare <层>` 不可用）。
```

# 附录 A · 176 行逐条结论

> 说明：B7.7 本阶段 ⛔ 不做、没有验收项，未列入下表。本轮「过」= 该条目验收清单在三遍复核中通过；「没过」= 已改回 ⬜；「状态不实」= 已改为 🟡。标 `*` 的条目验收清单通过，但仍有中级问题未降级，修复时一并处理（见第 2/3 节）。


### WP0（WP0 准备）

| 条目 | 本轮结论 | 说明 |
|---|---|---|
| P0.1 | 过 | 三遍复核验收清单通过 |
| P0.2 | 过 | 三遍复核验收清单通过 |
| P0.3 | 过 | 三遍复核验收清单通过 |
| P0.4 | 过 | 三遍复核验收清单通过 |
| P0.5 | 过 | 三遍复核验收清单通过 |
| P0.6 | 过 | 三遍复核验收清单通过 |
| P0.7 | 过 | 三遍复核验收清单通过 |

### WP1a（WP1 地基：一个记录库）

| 条目 | 本轮结论 | 说明 |
|---|---|---|
| A1 | 过 | 三遍复核验收清单通过 |
| C1.1 | 过 | 三遍复核验收清单通过 |
| C1.3 | 过 | 三遍复核验收清单通过 |
| C1.2 | 过 | 三遍复核验收清单通过 |
| A3 | 过 | 三遍复核验收清单通过 |

### WP1b（WP1 地基：一个记录库）

| 条目 | 本轮结论 | 说明 |
|---|---|---|
| A4 | 过 | 三遍复核验收清单通过 |
| A2 | 过 | 三遍复核验收清单通过 |
| C1.4 | 过 | 三遍复核验收清单通过 |
| C1.5 | 过 | 三遍复核验收清单通过 |
| C1.6 | 过 | 三遍复核验收清单通过 |
| C1.7 | **没过（改 ⬜）** | 脱敏后 persona_files.parseReport 仍存原始手机号/人名并回传浏览器 |

### WP2（WP2 修补：大厅与锚点）

| 条目 | 本轮结论 | 说明 |
|---|---|---|
| A5 | 过 | 三遍复核验收清单通过 |
| A6 | 过 | 三遍复核验收清单通过 |
| A7 | 过 | 三遍复核验收清单通过 |
| A8 | 过 | 三遍复核验收清单通过 |
| A9 | 过 | 三遍复核验收清单通过 |

### WP3a（WP3 读完全部记录）

| 条目 | 本轮结论 | 说明 |
|---|---|---|
| B1.1 | **没过（改 ⬜）** | 1–199 条记录分析阶段不读记录，estimate 谎报会读 N 段 |
| B1.2 | 过 | 三遍复核验收清单通过 |
| B1.3 | 过 | 三遍复核验收清单通过 |
| B1.4 | **状态不实（改 🟡）** | 动作标注准确率需真实模型；标签写回 DB 路径无测试 |
| B1.5 | **状态不实（改 🟡）** | 情绪回标准确率需真实模型；写回路径无测试 |
| C10.1 | **没过（改 ⬜）** | 伤害报告 snippets 进 JSON/分身包导出；soften 零覆盖；首次蒸馏过滤不生效 |

### WP3b（WP3 读完全部记录）

| 条目 | 本轮结论 | 说明 |
|---|---|---|
| B1.6 | 过 | 三遍复核验收清单通过 |
| B1.7 | 过 | 三遍复核验收清单通过 |
| B1.8 | 过（有遗留问题） * | 验收清单过，但有中级/低级问题，见问题清单 |
| B1.9 | 过 | 三遍复核验收清单通过 |
| B1.10 | 过 | 三遍复核验收清单通过 |

### WP4a（WP4 尺子）

| 条目 | 本轮结论 | 说明 |
|---|---|---|
| B3.1 | 过 | 三遍复核验收清单通过 |
| B3.2 | 过（有遗留问题） * | 验收清单过，但有中级/低级问题，见问题清单 |
| B8.7 | 过 | 三遍复核验收清单通过 |
| B8.6 | 过（有遗留问题） * | 验收清单过，但有中级/低级问题，见问题清单 |
| B8.1 | 过 | 三遍复核验收清单通过 |
| B8.2 | **没过（改 ⬜）** | 「朋友来测」邀请链接在 UI 流程必然 404；盲测理由候选指向错对象 |

### WP4b（WP4 尺子）

| 条目 | 本轮结论 | 说明 |
|---|---|---|
| B8.3 | 过（有遗留问题） * | 验收清单过，但有中级/低级问题，见问题清单 |
| B8.4 | **没过（改 ⬜）** | auditionInfo 成本报 0；不可达候选模型仍被评分甚至排第一 |
| B8.5 | **没过（改 ⬜）** | --ablate 在 --yes 之前调用模型（验收项失败） |
| B8.8 | 过（有遗留问题） * | 验收清单过，但有中级/低级问题，见问题清单 |
| B8.9 | 过 | 三遍复核验收清单通过 |
| B8.10 | **没过（改 ⬜）** | 材料体检「分状态统计」把非文本行算进去，会报够了而 B3.1 量不出 |

### WP5（WP5 语气指纹与硬约束）

| 条目 | 本轮结论 | 说明 |
|---|---|---|
| B2.7 | 过 | 三遍复核验收清单通过 |
| B3.4 | **没过（改 ⬜）** | 投影幂等性在可达指纹下不成立；strip_period 删气泡中间句号 |
| B3.3 | 过 | 三遍复核验收清单通过 |
| B3.5 | **状态不实（改 🟡）** | 手册 WP5 要求每条标 🟡 并写未验证清单，标了 ✅ 且缺行 |
| B3.6 | **状态不实（改 🟡）** | 同上；另贴纸草稿读了不存在的形状，永不产出 |
| B3.8 | 过 | 三遍复核验收清单通过 |
| B3.7 | 过 | 三遍复核验收清单通过 |

### WP6（WP6 生成方式）

| 条目 | 本轮结论 | 说明 |
|---|---|---|
| B2.3 | 过 | 三遍复核验收清单通过 |
| B2.1 | 过（有遗留问题） * | 验收清单过，但有中级/低级问题，见问题清单 |
| B2.2 | 过 | 三遍复核验收清单通过 |
| B2.6 | 过 | 三遍复核验收清单通过 |
| B2.5 | 过 | 三遍复核验收清单通过 |
| B2.4 | 过 | 三遍复核验收清单通过 |
| B2.8 | 过 | 三遍复核验收清单通过 |
| B2.9 | 过（有遗留问题） * | 验收清单过，但有中级/低级问题，见问题清单 |

### WP7（WP7 动作与情绪）

| 条目 | 本轮结论 | 说明 |
|---|---|---|
| B4.1 | 过（有遗留问题） * | 验收清单过，但有中级/低级问题，见问题清单 |
| B4.2 | 过（有遗留问题） * | 验收清单过，但有中级/低级问题，见问题清单 |
| B4.3 | 过（有遗留问题） * | 验收清单过，但有中级/低级问题，见问题清单 |
| B4.4 | 过（有遗留问题） * | 验收清单过，但有中级/低级问题，见问题清单 |
| B4.5 | 过 | 三遍复核验收清单通过 |
| B4.6 | 过（有遗留问题） * | 验收清单过，但有中级/低级问题，见问题清单 |
| B4.7 | 过（有遗留问题） * | 验收清单过，但有中级/低级问题，见问题清单 |
| B4.8 | 过 | 三遍复核验收清单通过 |

### WP8a（WP8 TA 的世界）

| 条目 | 本轮结论 | 说明 |
|---|---|---|
| B6.9 | 过 | 三遍复核验收清单通过 |
| B6.1 | 过（有遗留问题） * | 验收清单过，但有中级/低级问题，见问题清单 |
| B6.2 | 过（有遗留问题） * | 验收清单过，但有中级/低级问题，见问题清单 |
| B6.3 | **没过（改 ⬜）** | 作息挖掘（用户时区）与提示词（TA 时区）不一致 |
| B6.4 | 过（有遗留问题） * | 验收清单过，但有中级/低级问题，见问题清单 |

### WP8b（WP8 TA 的世界）

| 条目 | 本轮结论 | 说明 |
|---|---|---|
| B6.5 | 过 | 三遍复核验收清单通过 |
| B6.6 | **没过（改 ⬜）** | 记忆来源的「有依据」提示日期为空；问句识别漏「？」结尾 |
| B6.7 | 过（有遗留问题） * | 验收清单过，但有中级/低级问题，见问题清单 |
| B6.8 | 过（有遗留问题） * | 验收清单过，但有中级/低级问题，见问题清单 |

### WP9a（WP9 时间与节奏）

| 条目 | 本轮结论 | 说明 |
|---|---|---|
| C8.1 | 过 | 三遍复核验收清单通过 |
| B5.3 | 过 | 三遍复核验收清单通过 |
| B5.4 | 过 | 三遍复核验收清单通过 |
| B5.1 | 过 | 三遍复核验收清单通过 |

### WP9b（WP9 时间与节奏）

| 条目 | 本轮结论 | 说明 |
|---|---|---|
| B5.2 | 过（有遗留问题） * | 验收清单过，但有中级/低级问题，见问题清单 |
| B5.5 | 过 | 三遍复核验收清单通过 |
| B5.6 | 过 | 三遍复核验收清单通过 |
| B5.7 | 过 | 三遍复核验收清单通过 |
| B5.8 | 过（有遗留问题） * | 验收清单过，但有中级/低级问题，见问题清单 |

### WP10a（WP10 文字之外）

| 条目 | 本轮结论 | 说明 |
|---|---|---|
| B7.2 | 过 | 三遍复核验收清单通过 |
| B7.6 | 过（有遗留问题） * | 验收清单过，但有中级/低级问题，见问题清单 |
| B7.1 | 过 | 三遍复核验收清单通过 |
| B7.3 | **没过（改 ⬜）** | 转写不进 C2.2 检索；「在记录里看」未接阅读器 |
| B7.4 | 过 | 三遍复核验收清单通过 |

### WP10b（WP10 文字之外）

| 条目 | 本轮结论 | 说明 |
|---|---|---|
| B7.5 | 过（有遗留问题） * | 验收清单过，但有中级/低级问题，见问题清单 |
| B7.8 | 过（有遗留问题） * | 验收清单过，但有中级/低级问题，见问题清单 |
| B7.9 | 过 | 三遍复核验收清单通过 |
| B7.10 | 过 | 三遍复核验收清单通过 |
| B7.11 | **没过（改 ⬜）** | 截图校对页时间列 UTC 显示、编辑按浏览器时区解释 |

### WP10c（WP10 文字之外）

| 条目 | 本轮结论 | 说明 |
|---|---|---|
| B7.12 | 过 | 三遍复核验收清单通过 |
| B7.13 | 过 | 三遍复核验收清单通过 |
| B7.14 | **没过（改 ⬜）** | 打断不中止正在合成的音频，interrupt-ack 后仍发出并播放 |
| B7.15 | 过（有遗留问题） * | 验收清单过，但有中级/低级问题，见问题清单 |

### WP11a（WP11 回看真实记录）

| 条目 | 本轮结论 | 说明 |
|---|---|---|
| C8.6 | 过 | 三遍复核验收清单通过 |
| C8.7 | 过 | 三遍复核验收清单通过 |
| C2.10 | 过（有遗留问题） * | 验收清单过，但有中级/低级问题，见问题清单 |
| C2.2 | 过（有遗留问题） * | 验收清单过，但有中级/低级问题，见问题清单 |
| C2.3 | 过（有遗留问题） * | 验收清单过，但有中级/低级问题，见问题清单 |
| C2.1 | 过（有遗留问题） * | 验收清单过，但有中级/低级问题，见问题清单 |

### WP11b（WP11 回看真实记录）

| 条目 | 本轮结论 | 说明 |
|---|---|---|
| C2.4 | 过（有遗留问题） * | 验收清单过，但有中级/低级问题，见问题清单 |
| C2.5 | **没过（改 ⬜）** | 确认/批注过的转折在记录变化后消失 |
| C2.6 | 过（有遗留问题） * | 验收清单过，但有中级/低级问题，见问题清单 |
| C2.7 | 过（有遗留问题） * | 验收清单过，但有中级/低级问题，见问题清单 |
| C2.8 | 过（有遗留问题） * | 验收清单过，但有中级/低级问题，见问题清单 |
| C2.9 | 过（有遗留问题） * | 验收清单过，但有中级/低级问题，见问题清单 |

### WP12a（WP12 把话带回真人、「我」这一侧）

| 条目 | 本轮结论 | 说明 |
|---|---|---|
| C10.4 | 过 | 三遍复核验收清单通过 |
| C3.3 | **没过（改 ⬜）** | 用户自由文本 outbound.addOwn 未过 detectCrisis |
| C3.5 | **没过（改 ⬜）** | 用户自由文本 outbound.saveOutcome 未过 detectCrisis；said_it 未进关系事件 kind/i18n |
| C3.6 | 过 | 三遍复核验收清单通过 |
| C3.1 | 过（有遗留问题） * | 验收清单过，但有中级/低级问题，见问题清单 |

### WP12b（WP12 把话带回真人、「我」这一侧）

| 条目 | 本轮结论 | 说明 |
|---|---|---|
| C3.4 | 过（有遗留问题） * | 验收清单过，但有中级/低级问题，见问题清单 |
| C3.2 | **没过（改 ⬜）** | forcedAct 被冲突 repair 覆盖（验收项失败）；sceneOverlay 未进提示词 |
| C3.7 | **没过（改 ⬜）** | 见面当天入口用 TA 时区而非用户时区（验收明确项失败） |
| C4.5 | **没过（改 ⬜）** | 日记 create/update 未过 detectCrisis |
| C4.2 | **没过（改 ⬜）** | 「三次更难受」卡片未显示即记为已显示，常见场景永不出现 |

### WP12c（WP12 把话带回真人、「我」这一侧）

| 条目 | 本轮结论 | 说明 |
|---|---|---|
| C4.3 | 过（有遗留问题） * | 验收清单过，但有中级/低级问题，见问题清单 |
| C4.1 | 过 | 三遍复核验收清单通过 |
| C4.4 | **没过（改 ⬜）** | roleplay.end 的 note 未过 detectCrisis |
| C4.6 | 过（有遗留问题） * | 验收清单过，但有中级/低级问题，见问题清单 |

### WP13a（WP13 异地、告别、悼念）

| 条目 | 本轮结论 | 说明 |
|---|---|---|
| C5.1 | 过 | 三遍复核验收清单通过 |
| C5.2 | 过 | 三遍复核验收清单通过 |
| C5.3 | 过（有遗留问题） * | 验收清单过，但有中级/低级问题，见问题清单 |
| C5.4 | 过 | 三遍复核验收清单通过 |
| C5.5 | 过 | 三遍复核验收清单通过 |

### WP13b（WP13 异地、告别、悼念）

| 条目 | 本轮结论 | 说明 |
|---|---|---|
| C6.1 | 过 | 三遍复核验收清单通过 |
| C6.2 | **没过（改 ⬜）** | 封存后界面上没有任何可达的解封/删除/导出入口（阻断）；封存分身仍产出提醒 |
| C6.4 | 过 | 三遍复核验收清单通过 |
| C6.6 | 过 | 三遍复核验收清单通过 |
| C6.5 | 过 | 三遍复核验收清单通过 |

### WP13c（WP13 异地、告别、悼念）

| 条目 | 本轮结论 | 说明 |
|---|---|---|
| C6.3 | **没过（改 ⬜）** | 分享版纪念册未脱敏「地址」 |
| C7.1 | **状态不实（改 🟡）** | 悼念守则的模型层效果未量、未验证清单缺行 |
| C7.3 | 过（有遗留问题） * | 验收清单过，但有中级/低级问题，见问题清单 |
| C7.2 | **没过（改 ⬜）** | 撤销共用后家人删不掉自己那一行分身 |
| C7.4 | **状态不实（改 🟡）** | 真实模型抽取/真实转写/两账号链路未量（未验证清单已有 3 行） |

### WP14a（WP14 日常可用）

| 条目 | 本轮结论 | 说明 |
|---|---|---|
| C8.2 | 过 | 三遍复核验收清单通过 |
| C8.9 | 过（有遗留问题） * | 验收清单过，但有中级/低级问题，见问题清单 |
| C8.10 | 过（有遗留问题） * | 验收清单过，但有中级/低级问题，见问题清单 |
| C8.11 | **没过（改 ⬜）** | 删置顶→再置顶→撤销后可见置顶 4 条 |
| C8.12 | 过（有遗留问题） * | 验收清单过，但有中级/低级问题，见问题清单 |

### WP14b（WP14 日常可用）

| 条目 | 本轮结论 | 说明 |
|---|---|---|
| C8.13 | 过（有遗留问题） * | 验收清单过，但有中级/低级问题，见问题清单 |
| C8.14 | 过（有遗留问题） * | 验收清单过，但有中级/低级问题，见问题清单 |
| C1.8 | 过（有遗留问题） * | 验收清单过，但有中级/低级问题，见问题清单 |
| C8.3 | 过（有遗留问题） * | 验收清单过，但有中级/低级问题，见问题清单 |
| C8.4 | 过 | 三遍复核验收清单通过 |

### WP14c（WP14 日常可用）

| 条目 | 本轮结论 | 说明 |
|---|---|---|
| C8.8 | 过 | 三遍复核验收清单通过 |
| C8.5 | 过（有遗留问题） * | 验收清单过，但有中级/低级问题，见问题清单 |

### WP15a（WP15 通道与生态）

| 条目 | 本轮结论 | 说明 |
|---|---|---|
| C9.4 | 过 | 三遍复核验收清单通过 |
| C9.2 | 过（有遗留问题） * | 验收清单过，但有中级/低级问题，见问题清单 |
| C9.3 | 过（有遗留问题） * | 验收清单过，但有中级/低级问题，见问题清单 |
| C9.5 | 过（有遗留问题） * | 验收清单过，但有中级/低级问题，见问题清单 |

### WP15b（WP15 通道与生态）

| 条目 | 本轮结论 | 说明 |
|---|---|---|
| C9.6 | 过（有遗留问题） * | 验收清单过，但有中级/低级问题，见问题清单 |
| C9.1 | 过 | 三遍复核验收清单通过 |
| C9.7 | 过 | 三遍复核验收清单通过 |
| C9.8 | **没过（改 ⬜）** | 群消息未计入用户当天使用量（安全段明确要求） |

### WP16（WP16 安全与伦理）

| 条目 | 本轮结论 | 说明 |
|---|---|---|
| C10.2 | 过（有遗留问题） * | 验收清单过，但有中级/低级问题，见问题清单 |
| C10.3 | 过 | 三遍复核验收清单通过 |
| C10.5 | 过 | 三遍复核验收清单通过 |
| C10.6 | **没过（改 ⬜）** | 「不用这一项」在 abPairs 二选一特征上不生效（绕过 effectiveStyleProfile） |
| C10.7 | 过 | 三遍复核验收清单通过 |

### WP17（WP17 模型层）

| 条目 | 本轮结论 | 说明 |
|---|---|---|
| B9.3 | 过 | 三遍复核验收清单通过 |
| B9.1 | 过 | 三遍复核验收清单通过 |
| B9.2 | 过 | 三遍复核验收清单通过 |

### WP18（WP18 收尾）

| 条目 | 本轮结论 | 说明 |
|---|---|---|
| P18.1 | 过 | 三遍复核验收清单通过 |
| P18.2 | 过 | 三遍复核验收清单通过 |
| P18.3 | 过 | 三遍复核验收清单通过 |
| P18.4 | 过 | 三遍复核验收清单通过 |
| P18.5 | 过 | 三遍复核验收清单通过 |

# 附录 B · 第 1 遍逐单元问题索引（全部 83 条，按工作包）

> 每条一句话；逐条复现命令/输出在 /tmp/verify/pass1/<单元>.md。严重度取自原始报告。


## WP0

- [低] P0.5：P0.5 性能断言阈值比验收文字宽 4 倍（偏差 190 已记录）（位置：`server/test-fixtures/xiaoman.test.ts:89-93`）

## WP1

- [低] A1：A1 验收第 3 条与实测测试相反：`routers.file-upload-import.test.ts` 断言上传后**不**调用 `createCollectedMessages`（位置：`server/routers.file-upload-import.test.ts:99`（测试）、`docs/exec-v6.md:941`（验收）；等效四列断言在 `server/collectors/db-store.test.ts:526`；进度表偏差 605（`docs/exec-v6-progress.md:1039`）已自认。）
- [低] A1（`server/chat/exemplars-upload.test.ts：A1 验收第 4 条「先红后绿」未做到，且事后无法补证（位置：`server/chat/exemplars-upload.test.ts:144-182`；偏差 27（`docs/exec-v6-progress.md:447`）自认。）
- [低] A3 / C1.2（`server/importers/csv-not-unla：A3/C1.2 验收第 3 条「先红后绿」未做到（位置：`server/importers/csv-not-unlabelled.test.ts:16-38`；偏差 40（`docs/exec-v6-progress.md:460`）自认。）
- [低] C1.1：C1.1 验收第 1 条部分未满足：多个格式的夹具样本没有覆盖「该格式的每种消息类型」，其中若干映射路径没有任何测试（位置：`server/test-fixtures/exports/wechat-csv/sample.csv:1-18`、`server/importers/formats/wechat-csv.ts:21-40` 等（各格式见上）。）
- [低] C1.1：C1.1 验收第 7 条部分未满足：`wechat-json`（把握「中」）没有出处链接（位置：`server/importers/README.md:84-90`。）
- [低] C1.2：C1.2 验收第 2 条点名的测试文件不存在：实际是 `server/routers-v6/import.test.ts`（位置：`docs/exec-v6.md:1133`；`server/routers-v6/import.test.ts:230-303`。）
- [中] C1.7：C1.7：脱敏后 `persona_files.parseReport` 仍存原始手机号和被人名（位置：`server/importers/index.ts:353-371`（baseReport 的 `speakers`/`rawTable` 用脱敏前数据）、`:456-462`（`withRoles` 原样带进报告）、`:489-497`（写 `parseStatus:"done"` 的 parseReport）；对照 `:432-434` 只对记录行做了 `redactRecords`。）

## WP2

- [低] A7：A7 清单外残留：分身卡片仍按 chatCount 显示等级徽章（位置：`client/src/pages/Lobby.tsx:92-98,208-210,961-962,1072-1075`）

## WP3

- [中] B1.1（清单外边界；`docs/exec-v6.md:1507` 做法 10「：1–199 条结构化记录的分身：分析阶段完全不读记录，且预估谎报「会读 N 段」（位置：line）：）
- [中] B1.6 蒸馏完向用户追问：B1.6「跳过」不写入 `clarified`，跳过的问题下次还会再问，全部跳过时还显示“已经记进规则”（位置：`client/src/components/v6/ClarifyCard.tsx:108-120`（另 `:30`、`:32-40`）；对照 `shared/clarify.ts:392-400`、`server/routers.ts:2324`）
- [低] B1.8 每句结论能点回原话：B1.8 做法里的“点一条原话跳到记录阅读器那一行”在 C2.10 落地后仍未接上（位置：`client/src/components/v6/EvidenceList.tsx:60-73`；对照 `client/src/pages/Records.tsx:47,67-81,167-170`）

## WP4

- [中] B8.2 应用内盲测，手册 2073–2114 的**做法 3**（`blind：B8.2「朋友来测」的邀请链接在 UI 流程里必然失效（位置：`client/src/pages/BlindTest.tsx:169-195`、`server/routers-v6/blind.ts:255-267`、`:102-111`、`:269-278`。）
- [中] B8.2 手册 2090（做法 6）：「理由的统计喂给 v5 I1 的候选队列（：B8.2 盲测理由进 `fidelity.candidates` 时指向错对象，且这类候选无法确认（位置：`server/eval/blind.ts:232`；`server/eval/run.ts:378`；`server/routers.ts:7258-7272`、`:7317-7326`；`server/db.ts:4090-4106`。）
- [低] B3.2 做法 1 的公式（手册 1965 行）：`… + |字数 − 中位数|：B3.2 `lineSurprise` 的长度分母与手册公式不一致（位置：`shared/style-fingerprint.ts:965-973`、`:984-1005`；手册 `docs/exec-v6.md:1965`。）
- [中] B8.5：B8.5 验收项「没有 --yes 时不调用模型，只打印预估」未过：`--ablate` 在 --yes 之前就发起了一次模型调用（位置：line）：`scripts/eval-run.ts:299`（`const cases = (await labelEvalCases(cut, …))`，在 `if (ablate)` 的 :472 与 `if (!yes)` 的 :487 之前）；`server/eval/act-labels.ts:27-33`（缺标注就调 `labelMissingActs`）；`server/skill）
- [低] B8.3：B8.3 验收项「整个过程没有调用任何写库的 helper」的 mock 断言排除了一个真实写库 helper（位置：line）：`server/eval/drift.test.ts:120-130`（豁免 `insertLlmUsage`）、`:138-142`（`expectNoWrites`）；`server/chat/generate.ts:1473`（executePlan 传 `usage`）、`server/llm/usage.ts:179`（`insertLlmUsage`）。）
- [低] B8.4：B8.4 做法「任何一个失败就记下原因继续」未落到结果里，失败原因被丢弃（位置：line）：`server/eval/run.ts:366-371`（catch 后只 warn）、`:373`（该例直接丢弃）、`server/eval/audition.ts:208-213`（写固定文案）；`server/eval/audition.test.ts:147-151`。）

## WP5

- [中] B3.4（表格行 `exclaim_runs`）：B3.4 `exclaim_runs` 把指纹分桶下标当成连写长度，真实数据上「该截不截 / 截错长度」（位置：line）：）
- [低] B3.6（做法表「表情包」行）：B3.6 「不发表情包」草稿永远产出不了：读了不存在的 `stickers[state]` / `stickers.perState[state]` 形状（位置：line）：`shared/imperfection-draft.ts:255-261`（stickerRate/restStickerRate）、`:336-350`（numericByState 读 `source[state]`/`source.perState[state]`）；真实形状 `shared/sticker-stats.ts:44-46`；调用点还传的是上一版画像 `serve）

## WP7

- [低] B4.1：B4.1 进度表证据里的测试数过时：写「9 通过（原 5 + 邻接 4）」，实际 10（位置：`docs/exec-v6-progress.md:283`）

## WP8

- [中] B6.3 日常节律（手册 3263–3266「按『星期几 × 钟点』（**TA ：B6.3 作息挖掘的时区与手册/提示词不一致——两条挖掘入口用了两只不同的钟（位置：`server/routers.ts:660-664,721-741,7740`、`server/skill-engine/pipeline.ts:1891`、对照 `server/chat/generate.ts:247-251`、`server/chat/prompt.ts:249-253`、`server/_core/persona-utils.ts:875-881`、`shared/tim）
- [低] B6.1 / B6.2 进度证据（`docs/exec-v6-progress.：进度表 B6.1 行的 `term-match.test.ts` 通过数与实际不符（B6.2 行是修复后没更新）（位置：`docs/exec-v6-progress.md:299`（B6.1 行「`term-match.test.ts` 5 通过」）、`:300`（B6.2 行「`shared/stances.test.ts` 5 通过」）。）
- [中] B6.6（做法第 2 步 / 界面文案「有依据：`「{{text}}」— 记录里：记忆作依据的「有依据」提示里日期是空的：「记录里有（）」（位置：line）：`server/chat/service.ts:2903-2907`；`client/src/components/MessageBubble.tsx:843`；`client/src/i18n/zh.ts:295`、`client/src/i18n/en.ts:294`）
- [低] B6.6（做法第 1 步：地点 = 「引号里的专名」；验收第 1 条只测了「拾光：引号里的任何短语都被当成地点声明，普通回话会被标「记录里没找到」（位置：line）：`server/chat/fact-check.ts:156`（`QUOTED_RE` 不区分专名/普通引语）、`server/chat/fact-check.ts:381-394`（引号串一律 `pushClaim(kind:"place")`））
- [低] B6.7（做法第 3 步：手动创建/编辑时用已确认人物名在标题和描述里匹配，自动：手动记忆的 people 自动填充没走 term-match，单字别名在普通词里误命中（位置：line）：`shared/memory-entities.ts:67-77`（`peopleEntitiesInText` 用 `haystack.includes`）；调用点 `server/routers.ts:5748-5754`（create）、`:5789-5795`（update））

## WP9

- [中] B5.2（`reply_jobs` 数据层；手册 3634「部分唯一索引」+ 进：`createReplyJob` 唯一冲突回退失效：真实库上第二次插入同一待办会抛 DrizzleQueryError 而不是返回已有任务（位置：line）：`server/db.ts:3624-3626`（`isPgUniqueViolation` 只读顶层 `error.code`）、`server/db.ts:3628-3638`（catch 分支）；drizzle-orm 0.45.4 把 pg 错误包成 `DrizzleQueryError`，`code` 在 `error.cause.code`（`node_modules/.p）
- [低] B5.5，手册验收第 3 条（docs/exec-v6.md:3718）：B5.5 验收「连发三条时三个点出现三次」的组件测试用了服务端不会发出的 payload 形状（位置：`client/src/components/v6/useTypingReveal.test.ts:39-62`、`client/src/components/v6/useTypingReveal.ts:64-68`、`shared/typing-profile.ts:161-176`、`server/chat/service.ts:2516-2517`）
- [低] B5.8；依据 docs/exec-v6.md:3441「用户这一条消息命中危机：B5.8 通道入口没有 WP9 总规矩要求的危机/弱信号/难过用例（位置：`server/channels/bridge.test.ts`、`server/channels/feishu.test.ts`（缺用例）；对照 `server/chat/reply-jobs.test.ts:548-560`、`856-867` 已有危机用例。）

## WP10

- [中] B7.3 原声带（做法第 3 条「读**内容**的地方（…、C2.2 的检索）用：B7.3 的转写文本没有进 C2.2 的检索：读者里搜不到语音条里说过的话（位置：line）：）
- [低] B7.3 原声带（做法第 4 条「每条有『在记录里看』，跳到阅读器（C2.10）：B7.3「在记录里看」没有接到阅读器，只显示「记录第 N 条」文本（位置：line）：`client/src/pages/Voices.tsx:354-362`；对照 `client/src/pages/Records.tsx:178`、`client/src/pages/Mirror.tsx:66`）
- [低] WP10 共用基础设施（`ffmpeg.ts` 的「一律…环境变量用 `serv：whisper.cpp 与 `hasFfmpeg` 的子进程继承完整服务端环境，未用 `subprocessEnvironment()`（位置：line）：`server/_core/stt.ts:164`、`server/_core/ffmpeg.ts:46`；对照 `server/_core/subprocess-env.ts:1-14`、`server/_core/tts.ts:225`）
- [低] 进度表证据（只影响下一轮验收的可复算性，不影响代码行为）：进度表 B7.1/B7.2/B7.6 证据行的测试条数与当前实际不符（位置：line）：进度文件 `docs/exec-v6-progress.md:308`（B7.1 行）、`:309`（B7.2 行）、`:313`（B7.6 行））
- [中] B7.11（做法 3「每行能切换左右、改文字、改时间、删除」；界面文案「之后的一：B7.11 校对页的时间列显示的是 UTC，改动后按浏览器本地时区重新解释，存下来的时刻会整体偏移（位置：`client/src/components/v6/ScreenshotImport.tsx:214-226`）
- [低] B7.11（做法 2「整批都没有时间条：……消息从那天 12:00 起每条加 1：B7.11 无时间条时，不可解析的居中系统提示会占掉一分钟（位置：`server/importers/screenshot-merge.ts:242-254`）
- [低] B7.8（做法 3「对这个分身的照片逐张检测」）：B7.8 人脸聚类只扫相册前 40 张照片（位置：`client/src/components/v6/AvatarPicker.tsx:34,167`）
- [中] B7.14：B7.14 打断时不中止「正在合成」的那一句，音频在 `interrupt-ack` 之后仍发出，客户端还会播放（位置：`server/chat/call.ts:435-441`（循环只在发下一句前检查 `interrupted`；已 `await` 的 `deps.synthesize` 结果无条件 `audio(ws, voice)`）；`client/src/pages/Call.tsx:87-91`（二进制帧无条件 `playAudio`）。）
- [低] B7.15：B7.15 背景图路由比头像上传少一道「只读共享分身」守卫（代码推断）（位置：`server/routers.ts:1660-1704`（缺守卫）、对照 `:1587`、`:1625`；`server/_core/persona-access.ts:15-25`。）

## WP11

- [低] C2.1：C2.1「那年今天」：闰年的 2 月 28 日也把 2 月 29 日的记录摆出来（位置：`server/records/on-this-day.ts:68`（`const leap = wanted === "02-28";`）与 `:81`（`if (day !== wanted && !(leap && day === "02-29")) continue;`））
- [中] C2.5 关系心电图（进度 🟡）：C2.5：确认过/批注过的转折，在记录变化后从心电图里消失（位置：line）：`server/records/timeline.ts:355-369`（`buildTimeline` 只对 `findTurningPoints(series)` 的结果做决策叠加、没有把已确认但本次未检出的存盘候选并回输出）；`server/records/timeline.ts:285-292`（`StoredTurningPoint` 注明「只存用户决策」）；手动测试只覆盖记）
- [低] C2.6 第一次与最后一次（✅）；同样的写法在 C2.4、C2.5、C2.7、C：C2.6（同型出现在 C2.4/C2.5/C2.7/C2.8）：页面日期按 UTC ISO 截断，上海时区 00:00–07:59 的记录显示早一天（位置：line）：`client/src/components/v6/FirstsList.tsx:68`；同型：`client/src/pages/Report.tsx:211,214`、`client/src/components/v6/TimelineChart.tsx:130`、`client/src/components/v6/OurDictionary.tsx:93,139`、`client）
- [低] C2.9 TA 的说明书（🟡）：C2.9：说明书把分身名字双重转义（位置：line）：`server/_core/export-html.ts:502` 与 `:639,652,654`。）
- [低] C2.8 地图与歌单（🟡）：C2.8：无名且无坐标的 location 行被归成一个 `?, ?` 假地点（位置：line）：`server/records/places.ts:54-58`（`keyOf`）、`:75`（名字回退）、`:90-97`（只按 `kind==="location"` 收，不要求至少有名字或坐标）。）

## WP12

- [中] C3.3 出口常开 / C3.5 说出口了（同属 WP12「这一包的总规矩」第 ：C3.3「自己写一句」和 C3.5「后来怎么样」的用户自由文本没有过 `detectCrisis`：WP12 总规矩未实现（位置：line）：）
- [低] C3.6 措辞助手（做法第 2 条校验规则「里面出现的数字都在原句里出现过」）：C3.6 的「数字」校验只认 ASCII 数字：中文数字/全角数字可以新增事实（位置：line）：`shared/wording.ts:57-59`（`numbersIn` 正则）；用例入口 `server/routers.ts:8210`（`selectWordingSuggestions(letter.text, parsed)`）；测试 `shared/wording.test.ts:75-88` 只覆盖 ASCII 数字。）
- [低] C10.4 不变成监视工具（验收「测试通过」那一条的守则覆盖率）：C10.4 的结构测试能被「目录导入」绕过：`import … from "../collectors"` 不会变红（位置：line）：`server/no-surveillance.test.ts:78`、`:104-109`；可绕过的真实入口 `server/collectors/index.ts:22`（`runCollector` 等）、`server/channels/index.ts`、`server/wechat/`。）
- [中] C3.2 排练室（做法 3：「命中就带一句追加的指令重生成一次」）：C3.2 承诺重生成的「追加指令」没有进入提示词：第二次生成是同一个 prompt 的再摇一次（位置：`server/routers-v6/rehearsal.ts:274`；`server/chat/generate.ts:484-495`、`:585-625`；`server/chat/service.ts:680`（composeMessages 参数无 sceneOverlay）、`:818-828`。）
- [中] C3.2（做法 2「给了就不抽样，直接用它」；验收第 2 条「每次模型调用的计划：C3.2 forcedAct 不是最终裁决：冲突「强制和好」会把它改成 repair，验收「sampledAct 等于 forcedAct」不成立（位置：`server/chat/generate.ts:354-357`；测试缺口 `server/routers.rehearsal.test.ts:141-149`。）
- [中] C3.7（做法 3「见面那天（`settings.ldr.nextMeetAt`：C3.7 见面当天入口用的是 TA 的时区，不是用户时区（位置：`client/src/pages/Chat.tsx:2212-2217`（关键是 2216）；`client/src/components/v6/MeetDayNote.tsx:33-40`；对照 `client/src/pages/Chat.tsx:2223`。）
- [中] C4.2（做法 5「在聊天页显示一张卡片…同一组三次只提示一次」；验收「三次 w：C4.2 「三次更难受」的缓一缓卡片会未显示就记为已显示；用户忽略提问时这张卡片永远不会出现（位置：`client/src/components/v6/AfterChat.tsx:68-72` vs `:77-103`、`:105-123`；服务端 `server/safety/checkins.ts:127-144`（`worseSuggestion` 只按安全事件去重）。）
- [中] WP12 总规矩（`docs/exec-v6.md:4729-4730`：「用户：C4.5 / C3.4 违反 WP12 总规矩：用户输入没先过 detectCrisis，也没有危机用例（位置：`server/routers-v6/journal.ts:47-68`；`client/src/components/v6/MyJournal.tsx`（无 CrisisCard）；`server/routers-v6/record.ts:405-416`；`client/src/pages/Decode.tsx`（无 CrisisCard）；总规矩 `docs/exec-v6.md:4729-）
- [低] C3.2（界面文案：卡片上「大约十次里有 {{n}} 次 · {{act}}」，：C3.2 「不回」卡片把「{{name}} 可能不回」渲染两遍，并丢掉了比例（位置：`client/src/pages/Rehearsal.tsx:146-158`；测试 `client/src/pages/Rehearsal.test.tsx:107`。）
- [中] C4.4 角色互换：C4.4 `roleplay.end` 的 `note` 没有过 `detectCrisis`（位置：`server/routers-v6/roleplay.ts:178-197`（缺 `detectCrisis`）；对照 `:113`（say 有）；测试缺口 `server/routers.roleplay.test.ts:192-201`（只测“有 note → 一篇日记”，没测危机）。）
- [低] C4.3（同一份数据也进了 C4.6 的周行）：C4.3/C4.6「来了几次」按「天」陈述，手册界面文案是「次」；上一轮验收点过但只修了深夜占比，偏差表未登记（位置：`client/src/i18n/zh.ts:1849-1850`、`server/routers-v6/wellbeing.ts:100`、`server/_core/export-html.ts:681`。）
- [低] C4.4：C4.4 聊天页入口文案是「角色互换」，手册界面文案是「换个位置」；偏差表未登记（位置：`client/src/pages/Chat.tsx:2122`、`client/src/i18n/zh.ts:1805`。）

## WP13

- [低] C5.2：C5.2：日期线时区城市把「下一个日出/日落」显示错（正午显示日出而不是日落）（位置：line）：`client/src/components/v6/TheirSide.tsx:98-116`（`today = zonedDateKey(at, zone)` 后直接 `sunTimes(today, …)`）与 `shared/sun.ts:105-113`（UTC 日语义）+ `shared/sun.ts:18-20`（注释语义相反）。）
- [低] C5.3：C5.3：手册说「全局信箱里列出还没到时间的，可以取消」——全局信箱没有取消入口，取消说明也只在按分身的信箱里（位置：line）：`client/src/pages/Letters.tsx:293-314`（upcoming 列表无取消按钮）；`server/db.ts:1086-1093`（`listInboxScheduled` 状态过滤）；`server/routers.ts:6463-6467`（只组装 upcoming/capsules）；对比 `client/src/components/Letter）
- [低] C5.3：C5.3：用户自己点「取消」后，条目显示「那条没有送出去：那天不能聊。」（语义错误）（位置：line）：`client/src/components/v6/ScheduledList.tsx:76-85`（null 回退 reasonClosed）；`server/routers-v6/scheduled.ts:163-173`（cancel 不带 reason）；`server/db.ts:11706-11720`（`cancelScheduledItem` 默认 `reason:nu）
- [阻断] C6.2（手册 5371 行「例外（始终可用）：persona.getSetti：封存之后，手册要求「始终可用」的解封/删除入口，界面上一个都到不了（位置：`server/_core/trpc.ts:270-279`（白名单没有 `persona.get`）、`:400-405`（`persona.*` 的 `id` 也映射成 personaId）、`:430-435`（封存即 FORBIDDEN）；`client/src/pages/Lobby.tsx:1020-1031`（封存卡片无入口）与 `:1286`（删除按钮只在普通卡）；`client/）
- [低] C6.2（手册 5374 行「C8.5 的静态加密可用时，封存的同时提示用户可以：C6.2 做法 6 未做：封存时没有提示用户可以打开静态加密（位置：`client/src/components/v6/SealSettings.tsx`（整个文件无加密提示）；`client/src/pages/Graduation.tsx:515-525`。）
- [低] C6.5 三、1（手册 5472 行：`kind: "graduation_re：C6.5 回访提醒的 `kind` 与手册点名的不一致，且未记入偏差表（位置：`server/scheduler/reminders.ts:24,360-363`；`docs/exec-v6-progress.md` 偏差表 C6.5 段（737–746 行附近）。）
- [低] C6.6（进度表第 377 行）。：进度表 C6.6 行的测试条数高报：`farewell.test.ts` 记「12 通过」，实际 9（位置：`docs/exec-v6-progress.md:377`。）
- [低] C6.4 偏差 300（`docs/exec-v6-progress.md:73：偏差 300 已被后续实现推翻，但偏差表没更新（位置：`docs/exec-v6-progress.md:737`；`client/src/pages/Lobby.tsx:1020-1031`。）
- [中] C6.3：纪念册分享版没有脱敏「地址」（位置：`shared/redact.ts:9-18`（`RedactionOptions` 无地址项）、`server/routers-v6/book.ts:40-56`（`redactOne` 只传五项））
- [低] C6.3：切到「分享版」时不重置已勾选的照片，分享版照片默认不再为空（位置：`client/src/pages/Book.tsx:48-52,111`）
- [低] C7.1：C7.1「界面用词」的 `.memorial` 变体没有实现（位置：`client/src/pages/PersonaEdit.tsx:487`（标签无条件取 `personaEdit.togetherToLabel`）、`client/src/i18n/zh.ts:1580`、`client/src/i18n/zh.ts:632-633`、`client/src/pages/Lobby.tsx:1640,1644`）

## WP14

- [低] C8.9 成本面板（做法第 2 条「`server/llm/index.ts` ：C8.9 的「每一次调用写一行」对诊断探针不成立，且偏差 347 的未记路径清单里没有它（位置：line）：`server/system/diagnose-deps.ts:76-95`（探针不传 usage）、`server/llm/index.ts:373-382,453-463`（只记带 usage 的）、`server/llm/usage.test.ts:110-114`；偏差表：`docs/exec-v6-progress.md:785`（正文）、`:109,1137`（未验证清单，）
- [低] C8.10 对话管理（界面文案「菜单项：`收藏`、`置顶`、`从这里开始一个话题：C8.10 的菜单文案没有照用手册原文，偏差表也没记这条（位置：line）：`client/src/i18n/zh.ts:271,273,275`；手册要求 `docs/exec-v6.md:5756`、文案规矩 `docs/exec-v6.md:109`；偏差表 `docs/exec-v6-progress.md:790-795`（不含此条）。）
- [低] C8.14 可访问性 验收第 2/3 条：C8.14 验收第 3 条「这一阶段新加的每个组件都要过 a11y 测试」只部分满足：4 个 C8.4 浮层组件 + C8.5 的 EncryptionUnlockGate 不在渲染清单里，测试文件头自述不准确（位置：`client/src/a11y.test.tsx:13-47,832-861,863-1085`；`client/src/App.tsx:140-141`；`client/src/pages/Chat.tsx:1879`；`client/src/pages/Lobby.tsx:1996`；`client/src/components/v6/AppLock.tsx:113-199,209-268`）
- [低] C8.14 繁體界面（做法 2「服务端的 copy(locale,key)：zh：繁体界面：`zh-Hant` 在聊天流/语音通话/回信失败提示等文案路径被强转成 `zh`，繁体用户会看到简体句子（位置：`client/src/lib/chat-stream.ts:198,219,229,291,402`；`client/src/pages/Chat.tsx:980`；`server/chat/stream-route.ts:38,83,107`；`server/chat/call.ts:310,365,429,492`；`server/chat/reply-jobs.ts:284,313,501）
- [低] C8.5 验收第 2 条：C8.5「原始 SQL 每列无哨兵」的仓库测试有 3 列空转、4 个实现加密的列完全不在扫描里；进度表「夹具在 20 个列都放哨兵」不成立（位置：`server/encryption/encrypted-db.test.ts:77-98`、`:107-193`、`:219-226`、`:273-275`；`docs/exec-v6-progress.md:386`（"夹具在 20 个列都放哨兵"））
- [低] C8.8（证据准确性）：C8.8 进度行 `a11y.test.tsx` 条数与 HEAD 实测不符（自述 13，实测 19）（位置：`docs/exec-v6-progress.md:389`）
- [低] C8.8 验收第 4 条：手册 C8.8 第 4 条的验收命令照抄会失败（Swift 6 必须加 `-parse-as-library`）（位置：`docs/exec-v6.md:6040`；`scripts/build-macos-app.sh:399`；`docs/exec-v6-progress.md:874`（偏差 434））

## WP15

- [低] C9.5（手册 6201 行「包里没带记录时这些 `recordId` 置空（片：不带记录的包导入后，「留下的三句话」文字在应用读取路径上被丢掉（位置：`shared/persona-settings.ts:304-320`（`normalizeKeptQuotes`，`if (recordId === undefined || text === undefined) continue;` 在 311 行）；`server/personas/bundle.ts:742-746`（无记录时写 `recordId = null`）；`server/d）
- [低] C9.5（失败清理；验收只要求「库里没有残留的半个分身」，数据库这一条确实满足）：导入失败后 uploads 下留下空的分身目录（数据库是干净的）（位置：`server/personas/bundle.ts:582`（先 `mkdir(path.dirname(target))` 再 `copyFile`；sticker 侧 666、706 同理）；`server/personas/bundle.ts:776-780`（catch 只删 `writtenFiles`）。）
- [低] C9.5 做法 5 + 手册界面文案（6208 行）：导出说明应为「用来换机器、：导出区文案没有按手册写明「这里面是什么」（位置：`client/src/i18n/zh.ts:3788`（应含而未含）；对照 `client/src/i18n/zh.ts:3803`；`client/src/components/v6/PersonaBundle.tsx`。）
- [中] C9.8 群聊（手册 6350 安全段：「群里的消息计入用户当天的使用量」）：C9.8：群里的消息没有计入「用户当天的使用量」（位置：line）：）

## WP16

- [低] C10.2 验收第 4 条（`docs/exec-v6.md:6415`）：C10.2 验收第 4 条「对原有测试里的每一句正例再断言一遍」缺 1 句；进度证据写「57 条」也少算 1（位置：`server/safety/crisis.test.ts:41`；`server/safety/crisis-false-positive.test.ts:109-168`；`docs/exec-v6-progress.md:405`）
- [低] C10.2 现状段（`docs/exec-v6.md:6398`；附录 A `d：C10.2 手册要求记进偏差表的「不训练分类器」未出现在偏差表（位置：`docs/exec-v6.md:6398`、`:6750`；`docs/exec-v6-progress.md:1003-1005`（偏差表 WP16 段））

## WP17

- [低] shapeGrammar 只拦个位数列表符号：`12. ` / `10、` / `10）` 开头的行仍能通过

## WP18

- [低] P18.1（做法第 1 条；4 条验收不受影响，仍全过）：README 功能列表漏掉若干阶段 ✅ 条目（A8/A9/C1.4/C3.7 等），与 P18.1「做法」第 1 条不完全一致（位置：`README.md:329-412`（第六阶段功能列表；A1–A4 在 `:337`，之后直接 A5 缺失）、`README.en.md:51-123`、手册要求 `docs/exec-v6.md:6609`）
- [低] P18.2 验收第 4 条「草稿库已删除；`mirrai_live` 从头到尾没：P18.2 验收第 4 条字面不成立：`mirrai_live` 被连接过一次（记录自认）（位置：`docs/exec-v6-progress.md:204`、`:412`（P18.2 行）、`:1399`（批次日志））
- [低] P18.5 交付的「给用户的摘要」（非手册验收项）：「给用户的摘要」里 117 行未验证清单被 9 处空行切成 10 段表格（待用户决定 2 处同理）（位置：`docs/exec-v6-progress.md:76,91,107,117,121,125,130,143,146,182,184`）
