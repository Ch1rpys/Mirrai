# 第六阶段路线：把十九个工作包收成可以交出去的状态

> 这份文件是**状态盘点**，不是施工计划。施工与验收手册是 [`exec-v6.md`](exec-v6.md)，164 条建议的来由在 [`ideas-v6.md`](ideas-v6.md)，逐条的提交号与证据在 [`exec-v6-progress.md`](exec-v6-progress.md)。本文件按工作包把进度表收成一张表：每一包做到哪一步、落点在哪、还差什么。
>
> 状态：✅ 已实现并有测试 · 🟡 已实现、机器验收通过、真实效果未量 · ⬜ 未做 · ⛔ 本阶段决定不做 · 🔒 条件未满足，不执行
>
> **盘点时间**：2026-11-27 · 盘点对象 `/Users/ch1rpy/Desktop/Mirrai`（分支 `exec/v6`，没有推送、没有合并）
>
> **复盘时间**：2026-11-27 · 本文件随 WP18 收尾整理，状态、提交号、测试数与验收证据都引用自 [`exec-v6-progress.md`](exec-v6-progress.md)。WP18 的 P18.1–P18.5 已在 2026-11-27 完成：**P18.4（独立抽查）由另一个不带实施上下文的验收会话做完**（每包抽 3 条 + 14 条必查，去重 66 条全部重跑通过，名单与逐条证据见进度文件批次日志）。
>
> **它和前几份的关系**
>
> - 第六阶段的施工与验收手册是 [`exec-v6.md`](exec-v6.md)：每条怎么做、边界、验收清单都以它为准。
> - 164 条建议来自 [`ideas-v6.md`](ideas-v6.md)；两份冲突时以手册为准。
> - 逐条的提交号、验收证据、偏差表、未验证清单、待用户决定在 [`exec-v6-progress.md`](exec-v6-progress.md)。本文件只做摘要，状态与数字冲突时以进度表为准。
> - v5 及更早的路线图（[`roadmap-v5.md`](roadmap-v5.md)）不重做；它们记录的是当时的状态，不回填。
>
> 合计 **176 行**：P0.1–P0.7（7 条）、164 条建议（A1–A9、B1.1–B9.3、C1.1–C10.7）、P18.1–P18.5（5 条）。状态合计 **✅ 86 · 🟡 87 · ⛔ 1 · 🔒 2 · ⬜ 0**；P18.4 独立抽查已完成，176 行全部收口（2026-11-28 按「修复后独立验收」再修后的收尾值；建议数 164 条里 **74 ✅ / 87 🟡 / 1 ⛔ / 2 🔒**）。

## 哪些只到 🟡、为什么

**🟡 = 机器验收全过，但「更像 TA」这类效果还没在真实数据上量过。** 量它需要三样本机没有的东西：真实聊天记录、真实模型（本机没有配任何 LLM provider，测试里的 provider 全是桩），以及真人盲测、真机或真实外部账号。缺一样，这一层就只能证明「开关接对了、围栏没破、测试绿」，不能证明「加了它之后更像 TA」，所以最高只能标 🟡。逐条缺什么、该跑的命令、谁来跑，都在 [`exec-v6-progress.md`](exec-v6-progress.md) 的「未验证清单」。

87 条 🟡 按工作包分布：

| 工作包 | 🟡 | 工作包 | 🟡 |
|---|---|---|---|
| WP0 准备 | 0 | WP10 文字之外 | 14 |
| WP1 地基 | 0 | WP11 回看真实记录 | 6 |
| WP2 修补 | 0 | WP12 把话带回真人 | 8 |
| WP3 读完全部记录 | 2 | WP13 异地、告别、悼念 | 4 |
| WP4 尺子 | 6 | WP14 日常可用 | 4 |
| WP5 语气指纹与硬约束 | 7 | WP15 通道与生态 | 3 |
| WP6 生成方式 | 8 | WP16 安全与伦理 | 1 |
| WP7 动作与情绪 | 8 | WP17 模型层 | 1 |
| WP8 TA 的世界 | 7 | | |
| WP9 时间与节奏 | 8 | | |

WP0–WP2 全部 ✅；WP3 只剩 B1.4/B1.5 两条 🟡（动作/情绪标注的准确率要真实模型才能量）。按「缺什么」粗分（未验证清单共 125 行，有几行合并写相邻条目；下面的粗分是 117 行时的旧口径，新增的 8 行没有重分摊，具体以未验证清单为准）：

- **真实模型下的生成效果**（45 行）：WP5–WP8 的大部分层（B2.x、B3.x、B4.x、B6.x）和 B9.3 的 `logit_bias`/`grammar`。单测证明层按测量值发出、开关与围栏正确，但「加了这一层是否更像 TA、是否少编往事」只能跑 `pnpm eval --compare` / `--ablate` 才量得出来。
- **真实浏览器与真机观感**（27 行）：WP10 的语音、表情、照片、视频、通话和界面版式，WP11 的地图与打印，WP13 的纪念册打印，WP14 的可访问性、繁体、备份还原、应用锁，WP16 的深夜保护与解释页。jsdom 只证明组件接线与属性。
- **真实记录上的数字**（12 行）：年报、心电图、检索、等待尺、镜子等，夹具只证明算法与分桶，不证明这些数字对本人有意义。
- **真实外部账号与服务**（9 行）：微信、飞书、Telegram、Discord、Matrix 的一部分，SMTP 邮件，第三方 OpenAI 兼容客户端，真 Redis 上的两进程锁，真 Ollama 下的语义危机阈值。
- **其他真实环境**（17 行）与**文档/未实现**（7 行）：whisper.cpp 与 piper 真机、Windows/macOS 完整打包链、大分身导出耗时等；`wechat-html` 因为没有稳定静态 schema 未实现。

另外两处特殊状态：

- **⛔ 1 条**：B7.7 音色克隆。用户决定不做，由 B7.3 的原声带与 B7.5 的韵律参数代替（决策表在 [`exec-v6.md`](exec-v6.md) 第 1.2 节）。
- **🔒 2 条**：B9.1 本地适配器、B9.2 浅融合。解锁条件未满足，本阶段不训练任何东西，只做了只读的 `--unlock-check`；做不做在进度文件的「待用户决定」里。

## WP0 准备

（共 7 条：✅ 7）

| 编号 | 一句话 | 状态 | 落点 | 验收依据 |
|---|---|---|---|---|
| P0.1 | 分支、钩子、基线、进度文件 | ✅ | `docs/exec-v6-progress.md` | 提交 b3710ef、2fe5653；`git branch --show-current` → `exec/v6`；进度表 176 行 |
| P0.2 | 一条命令的总闸门 | ✅ | `scripts/gate-all.mjs` | 提交 b298550；`server/gate-script.test.ts` 3 通过 |
| P0.3 | 黄金快照 | ✅ | `shared/copy/prompt.ts` | 提交 e506484；`server/chat/prompt-golden.test.ts` 10 通过 |
| P0.4 | `personas.settings` 与 `styleProfile` 两列 | ✅ | `shared/persona-settings.ts`、`drizzle/schema.ts`、`drizzle/0044_persona_settings_and_style_profile.sql` | 提交 1e44f5d、e59ec6d；`shared/persona-settings.test.ts` 5 通过、`server/routers.persona-settings.test.ts` 3 通过；临时库四步与升级路径通过 |
| P0.5 | 夹具人物「小满」 | ✅ | `server/test-fixtures/xiaoman.ts`、`server/test-fixtures/render.ts`、`server/test-fixtures/seed-db.ts` | 提交 b1fe349、c785e6a、34f5564、ae2918e（验收修复）；2026-11-27 独立复验通过（41 通过、构建 76–100ms、往返 4904/4904），语音分母收紧 428d709；`xiaoman.test.ts` 41 通过 |
| P0.6 | 生成路径收拢 | ✅ | `server/chat/service.ts`、`server/eval/run.ts`、`server/chat/generate.ts` | 提交 1588608、b089be8、58d1123；`server/chat/service.test.ts` 通过、`stream.test.ts` 通过；闸门 266 passed |
| P0.7 | 出站清单 | ✅ | `shared/egress.ts`、`client/src/components/v6/EgressList.tsx`、`docs/egress.md` | 提交 16ad889、e6e22c1；`server/egress.test.ts` 4 通过、`EgressList.test.tsx` 通过 |

## WP1 地基：一个记录库

（共 11 条：✅ 11）

| 编号 | 一句话 | 状态 | 落点 | 验收依据 |
|---|---|---|---|---|
| A1 | 上传即入库 | ✅ | `server/collectors/db-store.ts`、`server/db.ts`、`server/routers-v6/import.ts` | 提交 6cf669d、c017aed、6736dc3；`server/db-records.test.ts` 5 通过、`server/routers.file-upload-import.test.ts` 通过 |
| A2 | 角色名归一 | ✅ | `server/skill-engine/roles.ts` | 提交 042d0bf；`roles.test.ts` 3 通过、`pipeline-v5-seam.test.ts` 通过 |
| A3 | 导入向导与解析预览 | ✅ | `server/importers/formats/wechat-csv.ts`、`server/importers/roles.ts` | 提交 267d8c6；`csv-not-unlabelled.test.ts` 通过 |
| A4 | 蒸馏直接读结构化行 | ✅ | `server/collectors/db-store.ts`、`server/routers.ts`、`server/skill-engine/pipeline.ts` | 提交 042d0bf、507c44c；`pipeline-v5-seam.test.ts` 2 通过、`db-store.test.ts` 通过 |
| C1.1 | 格式感知的导入器 | ✅ | `server/importers/detect.ts`、`server/importers/archive.ts`、`server/routers-v6/import.ts` | 提交 5723b34、29196ef、e9e6811；`roundtrip.test.ts` 15 通过、`detect.test.ts` 17 通过 |
| C1.2 | 导入向导与解析预览 | ✅ | `client/src/components/v6/ImportWizard.tsx`、`server/routers-v6/import.ts`、`client/src/pages/Upload.tsx` | 提交 267d8c6、50ab2ec；`ImportWizard.test.tsx` 5 通过、`routers-v6/import.test.ts` 通过 |
| C1.3 | 消息类型不丢 | ✅ | `server/importers/normalize.ts`、`server/importers/formats/wechat-csv.ts`、`shared/records.ts` | 提交 25d6d1a、14274b4；`normalize.test.ts` 通过、`wechat-csv.test.ts` 通过；闸门 299 passed |
| C1.4 | 多来源合并 | ✅ | `shared/scenes.ts`、`server/collectors/db-store.ts` | 提交 b80fc5f；`shared/scenes.test.ts` 通过、`db-store.test.ts` 通过；闸门 303 passed |
| C1.5 | 增量导入 | ✅ | `server/collectors/db-store.ts`、`server/_core/style-profile.ts`、`client/src/components/v6/StaleRecordsBanner.tsx` | 提交 d2858ff；`db-records.test.ts` 7 通过、`style-profile.test.ts` 4 通过 |
| C1.6 | 素材管理 | ✅ | `server/routers-v6/record.ts`、`client/src/components/v6/RecordSources.tsx`、`client/src/pages/Upload.tsx` | 提交 0b53159、d856d0e；`routers.file-delete.test.ts` 2 通过、`routers-v6/record.test.ts` 3 通过 |
| C1.7 | 导入时脱敏 | ✅ | `server/routers-v6/import.ts`、`client/src/components/v6/ImportWizard.tsx`、`server/importers/redact.ts` | 提交 825c73c；`redact.test.ts` 9 通过、`import.test.ts` 通过 |

## WP2 修补：大厅与锚点

（共 5 条：✅ 5）

| 编号 | 一句话 | 状态 | 落点 | 验收依据 |
|---|---|---|---|---|
| A5 | 拿掉「每日来信 · TA 想对你说」 | ✅ | `client/src/pages/Lobby.tsx`、`client/src/i18n/zh.ts`、`client/src/i18n/en.ts` | 提交 21981ee；`Lobby.test.tsx` 通过、`i18n.test.ts` 通过；闸门 310 passed |
| A6 | 「想你了」换成中性的数；推荐遵守状态 | ✅ | `client/src/pages/Lobby.tsx`、`client/src/lib/lobby-eligibility.ts`、`shared/timezone.ts` | 提交 8614668、d9f679d；`Lobby.test.tsx` 通过、`lobby-eligibility.test.ts` 5 通过 |
| A7 | 拿掉连续打卡、成就徽章、对话排行 | ✅ | `client/src/pages/Lobby.tsx`、`client/src/pages/Analytics.tsx`、`client/src/components/v6/Milestones.tsx` | 提交 8ceb9b8、3b5575e；`Lobby.test.tsx` 通过、`Analytics.test.tsx` 通过；闸门 313 passed |
| A8 | 分身自己说的话不能变成 TA 的事实 | ✅ | `client/src/components/v6/MemoryReview.tsx`、`server/chat/memory-extract.ts`、`client/src/pages/Chat.tsx` | 提交 2cfd462、0be929c、d14ba9d；`memory-extract-source.test.ts` 5 通过、`MemoryReview.test.tsx` 2 通过 |
| A9 | 危机热线核对 | ✅ | `server/safety/resources.ts`、`shared/egress.ts` | 提交 6ebeea3、17b934c；`resources.test.ts` 7 通过、`egress.test.ts` 4 通过 |

## WP3 读完全部记录

（共 11 条：✅ 9 · 🟡 2）

| 编号 | 一句话 | 状态 | 落点 | 验收依据 |
|---|---|---|---|---|
| B1.1 | 分层蒸馏 | ✅ | `server/skill-engine/chunks.ts`、`server/skill-engine/pipeline.ts`、`client/src/pages/Upload.tsx` | 提交 93aa60d、1fd5c18、14faa43；`chunks.test.ts` 6 通过、`pipeline-chunked.test.ts` 7 通过；迁移 `0046_distillation_tables` 四步与升级路径通过 |
| B1.2 | 抽样分层 | ✅ | `server/skill-engine/chunks.ts` | 提交 dbd08ca、99e8b2f；`chunks.test.ts` 3 通过 |
| B1.3 | 全量事实抽取 | ✅ | `shared/memory-date.ts`、`shared/fact-cues.ts`、`server/skill-engine/facts.ts` | 提交 c1e9484、ce3c3d9、ad296b3；`memory-date.test.ts` 3 通过、`fact-cues.test.ts` 3 通过 |
| B1.4 | 全量动作标注 | 🟡 | `shared/speech-acts.ts`、`server/skill-engine/label-acts.ts`、`shared/act-profile.ts` | 提交 89d0048、ade38b6；`acts-coverage.test.ts` 2 通过、`speech-acts.test.ts` 通过 |
| B1.5 | 历史情绪回标 | 🟡 | `server/skill-engine/label-emotions.ts` | 提交 db75f76；`act-buckets-emotion.test.ts` 3 通过 |
| B1.6 | 蒸馏完向用户追问 | ✅ | `shared/clarify.ts`、`client/src/components/v6/ClarifyCard.tsx` | 提交 4709167、ada73e8、41fe204；`shared/clarify.test.ts` 22 通过、`routers.clarify.test.ts` 3 通过 |
| B1.7 | 增量蒸馏 | ✅ | `server/skill-engine/observations.ts` | 提交 8499939、ad296b3；`pipeline-chunked.test.ts` 通过、`observations.test.ts` 通过；闸门 333 passed |
| B1.8 | 每句结论能点回原话 | ✅ | `shared/evidence-map.ts`、`client/src/components/v6/EvidenceList.tsx`、`client/src/pages/PersonaProfile.tsx` | 提交 420ef23、76a2694；`shared/evidence-map.test.ts` 4 通过、`routers.evidence.test.ts` 2 通过 |
| B1.9 | 人设版本史 | ✅ | `server/routers-v6/persona-version.ts`、`client/src/components/v6/VersionHistory.tsx`、`server/db.ts` | 提交 f965f92、298a524、77b0421；`db-persona-versions.test.ts` 2 通过、`persona-version.test.ts` 4 通过 |
| B1.10 | 把「我」也读一遍 | ✅ | `shared/user-side-profile.ts`、`server/chat/generate.ts` | 提交 26df59c、621c0ed；`shared/user-side-profile.test.ts` 2 通过、`generate.test.ts` 通过 |
| C10.1 | 不复现伤害 | ✅ | `shared/harm.ts`、`client/src/components/v6/HarmNotice.tsx` | 提交 178f815、4bde47e、092e6b8；`shared/harm.test.ts` 通过、`harm.test.ts` 通过；闸门 330 passed |

## WP4 尺子

（共 12 条：✅ 6 · 🟡 6）

| 编号 | 一句话 | 状态 | 落点 | 验收依据 |
|---|---|---|---|---|
| B3.1 | 语气指纹（测量） | ✅ | `shared/style-fingerprint.ts`、`client/src/components/v6/FingerprintView.tsx`、`client/src/components/FidelityPanel.tsx` | 提交 00d6e7a、e774ee2、2b7272e；`shared/style-fingerprint.test.ts` 26 通过、`FingerprintView.test.tsx` 2 通过 |
| B3.2 | 指纹进尺子 | ✅ | `shared/style-fingerprint.ts`、`server/eval/metrics.ts`、`scripts/eval-run.ts` | 提交 2e05643；`shared/style-fingerprint.test.ts` 通过、`metrics.test.ts` 通过；闸门 341 passed |
| B8.1 | 自动盲测员 | 🟡 | `server/eval/discriminator.ts`、`client/src/components/v6/DiscriminatorView.tsx`、`client/src/components/FidelityPanel.tsx` | 提交 e61eca3、cc0fa59；`discriminator.test.ts` 通过、`compare-cli.test.ts` 通过；闸门 343 passed |
| B8.2 | 应用内盲测 | 🟡 | `client/src/pages/BlindTest.tsx`、`client/src/pages/BlindGuest.tsx`、`server/skill-engine/feedback-aggregate.ts` | 提交 3e0eedf、c74ebb7、906d812；`routers.blind.test.ts` 通过、`BlindTest.test.tsx` 通过；迁移 `0048_blind_sessions` 四步与升级路径通过；闸门 347 passed |
| B8.3 | 多轮漂移尺 | 🟡 | `server/eval/drift.ts`、`scripts/eval-run.ts` | 提交 9babf31；`drift.test.ts` 通过、`prompt-fences.test.ts` 通过；闸门 348 passed |
| B8.4 | 模型试镜 | 🟡 | `server/eval/audition.ts`、`client/src/components/v6/AuditionView.tsx`、`client/src/components/FidelityPanel.tsx` | 提交 55f47b3、2e5314b；`audition.test.ts` 通过、`routers.eval.test.ts` 通过；闸门 350 passed |
| B8.5 | 逐段消融 | 🟡 | `server/eval/ablate.ts`、`server/eval/run.ts`、`scripts/eval-run.ts` | 提交 3e0eedf、23bd6fc、2b7272e；`compare-cli.test.ts` 通过、`run.test.ts` 通过；闸门 421 passed |
| B8.6 | 压噪声 | ✅ | `server/eval/metrics.ts`、`server/eval/run.ts` | 提交 3e0eedf、9c13769；`metrics.test.ts` 通过、`compare-cli.test.ts` 通过；闸门 341 passed |
| B8.7 | 标答分层 | ✅ | `server/eval/dataset.ts`、`server/eval/metrics.ts`、`server/eval/run.ts` | 提交 3e0eedf、dc2e6da、2b7272e；`dataset.test.ts` 通过、`metrics.test.ts` 通过；迁移 `0047_eval_cases_period` 四步与升级路径通过；闸门 421 passed |
| B8.8 | 二选一 | 🟡 | `server/eval/ab-pairs.ts`、`client/src/components/v6/ChoiceBubble.tsx`、`client/src/components/v6/PersonaSwitches.tsx` | 提交 3e0eedf、26e83a6、ef5bead；`service.test.ts` 通过、`ab-pairs.test.ts` 通过；迁移 `0049_fidelity_pairs` 四步与升级路径通过；闸门 353 passed |
| B8.9 | 保真面板加历史 | ✅ | `client/src/components/v6/FidelityHistory.tsx`、`client/src/components/FidelityPanel.tsx` | 提交 600eca3；`FidelityHistory.test.tsx` 通过、`routers.blind.test.ts` 通过；闸门 354 passed |
| B8.10 | 材料体检 | ✅ | `shared/material-report.ts`、`client/src/components/v6/MaterialReport.tsx`、`shared/periods.ts` | 提交 e80c4d0、ec91af6、cc50ed1；`material.test.ts` 3 通过、`material-report.test.ts` 通过 |

## WP5 语气指纹与硬约束

（共 7 条：🟡 7）

| 编号 | 一句话 | 状态 | 落点 | 验收依据 |
|---|---|---|---|---|
| B2.7 | 长度硬上限 | 🟡 | `shared/length-cap.ts`、`server/chat/generate.ts`、`server/llm/types.ts` | 提交 9147cf4、89f29db；`shared/length-cap.test.ts` 7 通过、`server/llm/providers/stop.test.ts` 4 通过 |
| B3.3 | 指纹进重排 | 🟡 | `server/chat/rerank.ts`、`server/chat/rerank-model.ts`、`server/chat/generate.ts` | 提交 020c183、78f2500；`rerank-empty-corpus.test.ts` 通过、`rerank.test.ts` 6 通过 |
| B3.4 | 确定性投影 | 🟡 | `shared/style-projection.ts`、`server/chat/generate.ts`、`client/src/components/v6/PersonaSwitches.tsx` | 提交 16c888f、498033c；`shared/style-projection.test.ts` 27 通过、`generate.test.ts` 通过 |
| B3.5 | 分态指纹 → 判别规则候选 | 🟡 | `server/skill-engine/state-rules.ts`、`client/src/components/MicroRulesEditor.tsx` | 提交 6dbb539；`state-rules.test.ts` 3 通过、`fidelity-prompt.test.ts` 通过 |
| B3.6 | 分态不完美自动起草 | 🟡 | `shared/imperfection-draft.ts`、`client/src/components/ImperfectionEditor.tsx`、`shared/copy/v6.ts` | 提交 b15124e；`shared/imperfection-draft.test.ts` 通过、`ImperfectionEditor.test.tsx` 通过；闸门 363 passed |
| B3.7 | TA 的词 | 🟡 | `server/chat/generate.ts`、`client/src/components/v6/LexiconEditor.tsx`、`server/skill-engine/lexicon.ts` | 提交 d2397b8、7e4a4ff；`lexicon.test.ts` 5 通过、`fidelity-prompt.test.ts` 通过 |
| B3.8 | 称呼史 | 🟡 | `shared/address-history.ts`、`client/src/components/v6/AddressHistoryView.tsx`、`client/src/pages/PersonaProfile.tsx` | 提交 03c7200；`address-history.test.ts` 通过、`prompt-fences.test.ts` 通过；闸门 365 passed |

## WP6 生成方式

（共 8 条：🟡 8）

| 编号 | 一句话 | 状态 | 落点 | 验收依据 |
|---|---|---|---|---|
| B2.1 | 把原话放进对话轮次 | 🟡 | `shared/seed-safety.ts`、`server/chat/seed-turns.ts`、`server/chat/generate.ts` | 提交 5c7cb3c、2b5a53c；`shared/seed-safety.test.ts` 8 通过、`seed-turns.test.ts` 2 通过 |
| B2.2 | 仪式应答表 | 🟡 | `shared/ritual-table.ts`、`server/chat/generate.ts`、`client/src/components/v6/RitualsView.tsx` | 提交 eca88ed、4a9e816、cc50ed1；`shared/ritual-table.test.ts` 6 通过、`style-profile.test.ts` 通过 |
| B2.3 | 示范检索换键 | 🟡 | `server/chat/exemplars.ts`、`server/chat/embeddings.ts`、`shared/egress.ts` | 提交 166458b、abf59f0、efdca0d；`exemplars.test.ts` 11 通过、`embeddings.test.ts` 11 通过；迁移 `0050_record_embeddings` 四步通过 |
| B2.4 | 先定内容，再换嗓子 | 🟡 | `server/chat/generate.ts`、`client/src/components/v6/PersonaSwitches.tsx` | 提交 915917e、1638e9e；`generate.test.ts` 通过、`PersonaSwitches.test.tsx` 通过；闸门 377 passed |
| B2.5 | 负例对 | 🟡 | `server/chat/generate.ts`、`server/eval/dataset.ts`、`client/src/components/MessageBubble.tsx` | 提交 9d1bea6、2b834b7；`routers.fidelity-rewrite.test.ts` 3 通过、`generate.test.ts` 通过；迁移 `0051_fidelity_rewrite` 四步与升级路径通过 |
| B2.6 | 防自污染 | 🟡 | `shared/sample-pool.ts`、`shared/style-reminder.ts`、`server/chat/generate.ts` | 提交 51fccde、035613c、1638e9e；`shared/sample-pool.test.ts` 4 通过、`style-profile.test.ts` 通过 |
| B2.8 | 按调用点分工，按分身调参 | 🟡 | `server/llm/user-provider.ts`、`server/llm/extra-body.ts`、`shared/persona-settings.ts` | 提交 903a94f、c0b2f6b、f88cab5；`server/llm/purpose.test.ts` 通过、`user-provider.test.ts` 通过；闸门 382 passed |
| B2.9 | 提示词缓存 | 🟡 | `server/_core/env.ts`、`scripts/fidelity-gate.ts` | 提交 54ea4ac；`prompt-layout.test.ts` 5+1 通过、`stop.test.ts` 通过 |

## WP7 动作与情绪

（共 8 条：🟡 8）

| 编号 | 一句话 | 状态 | 落点 | 验收依据 |
|---|---|---|---|---|
| B4.1 | 邻接对 | 🟡 | `shared/act-profile.ts`、`server/chat/generate.ts`、`client/src/components/V5FidelityEditors.tsx` | 提交 4febb6c、7cc254b；`shared/act-profile.test.ts` 9 通过、`generate.test.ts` 通过 |
| B4.2 | 动作下面挂原话簇 | 🟡 | `shared/act-clusters.ts`、`server/chat/generate.ts`、`server/chat/exemplars.ts` | 提交 9de5c63；`shared/act-clusters.test.ts` 4 通过、`style-profile.test.ts` 通过 |
| B4.3 | 情绪惯性 | 🟡 | `shared/emotion-dynamics.ts`、`client/src/components/v6/PersonaSwitches.tsx`、`server/_core/emotion.ts` | 提交 554c965、b032823、7cc254b；`shared/emotion-dynamics.test.ts` 5 通过、`service.test.ts` 通过；迁移 `0052_emotional_state_since` 四步与升级路径通过 |
| B4.4 | 冲突与和好的剧本 | 🟡 | `server/skill-engine/conflicts.ts`、`server/chat/generate.ts` | 提交 4d42d07、297ce15、7cc254b；`server/skill-engine/conflicts.test.ts` 4 通过、`generate.test.ts` 通过 |
| B4.5 | 雷区表 | 🟡 | `server/chat/generate.ts`、`client/src/components/v6/TriggersView.tsx`、`client/src/pages/PersonaProfile.tsx` | 提交 ee32c67；`conflicts.test.ts` 通过、`style-profile.test.ts` 通过；闸门 388 passed |
| B4.6 | 会收尾的 TA | 🟡 | `shared/session-profile.ts`、`server/chat/generate.ts`、`client/src/components/v6/PersonaSwitches.tsx` | 提交 07019c3、0daab58、7cc254b；`shared/session-profile.test.ts` 6 通过、`generate.test.ts` 通过 |
| B4.7 | 只接半句 | 🟡 | `shared/multi-point.ts`、`shared/suppressions.ts`、`shared/copy/v6.ts` | 提交 62acc48；`shared/multi-point.test.ts` 3 通过、`fidelity-prompt.test.ts` 通过 |
| B4.8 | 会话内的起话头 | 🟡 | `shared/in-session.ts`、`server/chat/generate.ts` | 提交 4ad35f6、d29d4b2、7cc254b；`shared/in-session.test.ts` 通过、`generate.test.ts` 通过 |

## WP8 TA 的世界

（共 9 条：✅ 2 · 🟡 7）

| 编号 | 一句话 | 状态 | 落点 | 验收依据 |
|---|---|---|---|---|
| B6.1 | 人物表 | 🟡 | `shared/people.ts`、`server/chat/generate.ts`、`client/src/components/v6/WorldEditors.tsx` | 提交 9e6dcc0、d82a6ee；`shared/people.test.ts` 8 通过、`generate.test.ts` 通过 |
| B6.2 | 喜恶与立场 | 🟡 | `shared/stances.ts`、`server/chat/generate.ts`、`client/src/components/v6/WorldEditors.tsx` | 提交 7d942a8；`shared/stances.test.ts` 5 通过、`generate.test.ts` 通过 |
| B6.3 | 日常节律 | 🟡 | `server/skill-engine/routine.ts`、`shared/life-events.ts`、`server/chat/generate.ts` | 提交 46fc165、d29d4b2；`server/skill-engine/routine.test.ts` 通过、`shared/life-events.test.ts` 通过；闸门 397 passed |
| B6.4 | 知识边界 | 🟡 | `server/skill-engine/knowledge-boundary.ts`、`shared/topic-domains.ts` | 提交 c280031；`knowledge-boundary.test.ts` 4 通过、`fidelity-prompt.test.ts` 通过 |
| B6.5 | 时间边界 | 🟡 | `server/chat/prompt.ts` | 提交 ee77205；`prompt.test.ts` 通过、`prompt-golden.test.ts` 10 通过 |
| B6.6 | 事实核查 | 🟡 | `server/chat/fact-check.ts`、`server/chat/generate.ts`、`client/src/components/MessageBubble.tsx` | 提交 5549ead、9f0d83d；`fact-check.test.ts` 5 通过、`service.test.ts` 通过 |
| B6.7 | 记忆之间有关系 | ✅ | `server/chat/retrieval.ts`、`server/skill-engine/facts.ts`、`server/chat/memory-extract.ts` | 提交 1dcaf36；`db-delete-coverage.test.ts` 9 通过、`retrieval.test.ts` 通过；迁移 `0053_memory_entities` 四步与升级路径通过 |
| B6.8 | 忘的概率 | ✅ | `server/chat/retrieval.ts` | 提交 20a28b7；`retrieval.test.ts` 通过；闸门 401 passed |
| B6.9 | 自述账本 | 🟡 | `server/chat/retrieval.ts`、`client/src/components/v6/MemoryReview.tsx`、`server/chat/farewell-candidates.ts` | 提交 881d917；`memory-extract-source.test.ts` 通过、`retrieval.test.ts` 通过；闸门 392 passed |

## WP9 时间与节奏

（共 9 条：✅ 1 · 🟡 8）

| 编号 | 一句话 | 状态 | 落点 | 验收依据 |
|---|---|---|---|---|
| B5.1 | 读和回分开 | ✅ | `server/chat/inbox.ts`、`client/src/pages/Chat.tsx`、`server/channels/bridge.ts` | 提交 b7f507c、bdab495、4e62c84；`inbox.test.ts` 5 通过、`service.test.ts` 通过 |
| B5.2 | 真的晚点回 | 🟡 | `server/chat/reply-jobs.ts`、`client/src/components/v6/PendingReply.tsx`、`client/src/components/v6/PersonaSwitches.tsx` | 提交 632d2f1、c8c75e8、161a3ef；`reply-jobs.test.ts` 13 通过、`routers.pending-reply.test.ts` 4 通过；迁移 `0055_reply_jobs` 四步与升级路径通过 |
| B5.3 | 条件化的延迟 | 🟡 | `shared/reply-delay.ts`、`client/src/components/v6/DelayView.tsx`、`shared/behavior-profile.ts` | 提交 59d801e；`shared/reply-delay.test.ts` 4 通过、`service.test.ts` 通过 |
| B5.4 | 作息 | 🟡 | `shared/routine-profile.ts`、`client/src/components/v6/DelayView.tsx`、`client/src/components/v6/PersonaSwitches.tsx` | 提交 182da75；`shared/routine-profile.test.ts` 5 通过、`DelayView.test.tsx` 通过 |
| B5.5 | 正在输入 | 🟡 | `shared/typing-profile.ts`、`client/src/components/v6/useTypingReveal.ts`、`client/src/components/MessageBubble.tsx` | 提交 32f5c75、be30d51；`shared/typing-profile.test.ts` 5 通过、`style-profile.test.ts` 通过 |
| B5.6 | 撤回、补一句、拍一拍 | 🟡 | `shared/quirks-profile.ts`、`server/_core/style-profile.ts`、`client/src/components/MessageBubble.tsx` | 提交 78fc095、c374b6f；`shared/quirks-profile.test.ts` 3 通过、`server/_core/style-profile.test.ts` 通过 |
| B5.7 | 会话内追一句 | 🟡 | `shared/double-text.ts`、`server/_core/style-profile.ts`、`server/chat/reply-jobs.ts` | 提交 bf8d483、9baa217；`shared/double-text.test.ts` 2 通过、`server/_core/style-profile.test.ts` 通过 |
| B5.8 | 通道上同一套节奏 | 🟡 | `server/chat/inbox.ts`、`server/chat/silence-notice.ts`、`server/channels/bridge.ts` | 提交 dc21aab、32ed6d5；`inbox.test.ts` 通过、`silence-notice.test.ts` 2 通过 |
| C8.1 | 推送 | 🟡 | `client/src/components/v6/PushSettings.tsx`、`shared/egress.ts`、`server/_core/notification.ts` | 提交 1c094f6、cbc794c、986b225；`push.test.ts` 4 通过、`routers.push.test.ts` 2 通过；迁移 `0054_push_subscriptions` 四步与升级路径通过 |

## WP10 文字之外

（共 15 条：🟡 14 · ⛔ 1）

| 编号 | 一句话 | 状态 | 落点 | 验收依据 |
|---|---|---|---|---|
| B7.1 | 表情包 | 🟡 | `server/importers/stickers.ts`、`server/routers-v6/sticker.ts`、`shared/sticker-stats.ts` | 提交 986044c、6f2f193、5eec6f1；`db-isolation.test.ts` 13 通过、`db-delete-coverage.test.ts` 9 通过；迁移 `0056_stickers` 四步与升级路径通过 |
| B7.2 | 本地语音转写 | 🟡 | `server/_core/local-endpoint.ts`、`server/_core/ffmpeg.ts`、`server/_core/stt.ts` | 提交 e8e3485；`server/_core/local-endpoint.test.ts` 5 通过、`server/_core/ffmpeg.test.ts` 9 通过 |
| B7.3 | 原声带 | 🟡 | `server/media/transcribe.ts`、`shared/records.ts`、`client/src/pages/Voices.tsx` | 提交 24ec246、5e26738、7fd3a9f；`importers/media.test.ts` 5 通过、`db-media.test.ts` 3 通过；迁移 `0057_media` 四步与升级路径通过 |
| B7.4 | 语音条习惯 | 🟡 | `shared/voice-stats.ts`、`server/_core/style-profile.ts`、`server/chat/voice-note.ts` | 提交 9f6fa4c；`shared/voice-stats.test.ts` 6 通过、`server/_core/style-profile.test.ts` 通过 |
| B7.5 | 韵律参数 | 🟡 | `shared/prosody.ts`、`server/_core/prosody.ts`、`client/src/components/v6/ProsodyView.tsx` | 提交 36a6c0f；`shared/prosody.test.ts` 8 通过、`server/_core/prosody.test.ts` 4 通过 |
| B7.6 | 本地 TTS | 🟡 | `server/_core/tts.ts`、`client/src/components/v6/TtsNote.tsx`、`client/src/components/MessageBubble.tsx` | 提交 69848c3；`server/_core/tts.test.ts` 19 通过、`TtsNote.test.tsx` 4 通过 |
| B7.7 | 音色克隆 | ⛔ | — | 用户决定不做（手册 §1.2）；由 B7.3 原声带与 B7.5 韵律参数代替 |
| B7.8 | 照片 | 🟡 | `server/_core/image-exif.ts`、`server/_core/persona-image.ts`、`server/_core/face-models.ts` | 提交 0eac981、d53a429、3e080e2；`db-memory-media.test.ts` 3 通过、`image-exif.test.ts` 4 通过；迁移 `0058_memory_media` 四步与升级路径通过 |
| B7.9 | TA 发来一张照片 | 🟡 | `shared/photo-stats.ts`、`server/chat/photo-turn.ts`、`server/chat/service.ts` | 提交 36fd07f；`shared/photo-stats.test.ts` 3 通过、`server/chat/photo-turn.test.ts` 6 通过 |
| B7.10 | 视频 | 🟡 | `server/skill-engine/video.ts`、`server/skill-engine/video-materials.ts`、`server/_core/ffmpeg.ts` | 提交 835e76e；`system-capabilities.test.ts` 1 通过、`video.test.ts` 4 通过 |
| B7.11 | 截图导入 | 🟡 | `server/importers/screenshot-merge.ts`、`server/importers/screenshot.ts`、`client/src/components/v6/ScreenshotImport.tsx` | 提交 4e22470；`screenshot-merge.test.ts` 6 通过、`screenshot.test.ts` 3 通过 |
| B7.12 | 动态 | 🟡 | `server/importers/moments.ts`、`server/skill-engine/public-voice.ts`、`server/_core/style-profile.ts` | 提交 aad6930；`server/importers/moments.test.ts` 5 通过、`routers.screenshot.test.ts` 通过 |
| B7.13 | 通话记录 | 🟡 | `shared/call-stats.ts`、`server/_core/style-profile.ts`、`shared/style-profile.ts` | 提交 7de23a6；`shared/call-stats.test.ts` 4 通过、`server/_core/style-profile.test.ts` 通过 |
| B7.14 | 电话模式 | 🟡 | `server/chat/call.ts`、`client/src/pages/Call.tsx`、`client/src/components/v6/PersonaSwitches.tsx` | 提交 e663d5b；`server/chat/call.test.ts` 16 通过、`Call.test.tsx` 2 通过 |
| B7.15 | 界面也是像的一部分 | 🟡 | `client/src/components/v6/TimeBar.tsx`、`client/src/styles/skins.css`、`client/src/components/v6/SkinPicker.tsx` | 提交 6e8afd3；`TimeBar.test.tsx` 4 通过、`skins.test.ts` 1 通过 |

## WP11 回看真实记录

（共 12 条：✅ 6 · 🟡 6）

| 编号 | 一句话 | 状态 | 落点 | 验收依据 |
|---|---|---|---|---|
| C2.1 | 那年今天 | ✅ | `server/records/on-this-day.ts`、`client/src/components/v6/OnThisDay.tsx`、`client/src/pages/Lobby.tsx` | 提交 15e345c；`server/records/on-this-day.test.ts` 4 通过、`client/src/components/v6/OnThisDay.test.tsx` 4 通过 |
| C2.2 | 原话检索 | ✅ | `client/src/components/v6/RecordSearch.tsx`、`client/src/pages/Records.tsx`、`client/src/components/CommandPalette.tsx` | 提交 6617bd7；`server/routers.record-search.test.ts` 6 通过、`server/db-search.test.ts` 通过 |
| C2.3 | 这句是原话吗 | ✅ | `server/records/nearest.ts`、`client/src/components/v6/SaidBefore.tsx`、`client/src/components/MessageBubble.tsx` | 提交 dd11cd4；`server/records/nearest.test.ts` 6 通过、`client/src/components/v6/SaidBefore.test.tsx` 3 通过 |
| C2.4 | 关系年报 | 🟡 | `server/records/report.ts`、`client/src/pages/Report.tsx`、`client/src/pages/Analytics.tsx` | 提交 b7ef9d4、c7249e2；`server/records/report.test.ts` 7 通过、`server/routers.record-report.test.ts` 4 通过；临时库四步与升级路径通过 |
| C2.5 | 关系心电图 | 🟡 | `server/records/timeline.ts`、`server/chat/prompt.ts`、`client/src/components/v6/TimelineChart.tsx` | 提交 b7ef9d4、c7249e2；`server/records/timeline.test.ts` 5 通过、`server/routers.turning-point.test.ts` 3 通过 |
| C2.6 | 第一次与最后一次 | ✅ | `server/records/firsts.ts`、`client/src/components/v6/FirstsList.tsx` | 提交 b7ef9d4、c7249e2；`server/records/firsts.test.ts` 3 通过、`FirstsList.test.tsx` 2 通过 |
| C2.7 | 我们的词典 | ✅ | `client/src/components/v6/OurDictionary.tsx` | 提交 c7249e2；`client/src/components/v6/OurDictionary.test.tsx` 4 通过 |
| C2.8 | 地图与歌单 | 🟡 | `server/records/places.ts`、`server/records/songs.ts`、`client/src/components/v6/PlacesSongs.tsx` | 提交 662e4da、b7ef9d4、c7249e2；`server/records/places.test.ts` 3 通过、`songs.test.ts` 2 通过 |
| C2.9 | TA 的说明书 | 🟡 | `server/_core/export-html.ts`、`shared/fingerprint-prose.ts` | 提交 b7ef9d4、c7249e2；`server/export-html.test.ts` 9 通过、`shared/fingerprint-prose.test.ts` 4 通过 |
| C2.10 | 时间线阅读器 | ✅ | `client/src/pages/Records.tsx`、`server/routers-v6/record.ts`、`server/db.ts` | 提交 14ea90d、66f2d6e；`server/db-record-page.test.ts` 4 通过、`server/routers.record.test.ts` 7 通过；临时库四步与升级路径通过 |
| C8.6 | 全文检索与语义检索 | 🟡 | `shared/search-tokens.ts`、`server/chat/embeddings.ts`、`server/db.ts` | 提交 fa12604；`shared/search-tokens.test.ts` 6 通过、`server/db-search.test.ts` 5 通过；临时库四步与升级路径通过 |
| C8.7 | 示范检索改成查询 | 🟡 | `server/chat/exemplar-query.ts`、`server/chat/service.ts`、`server/chat/prompt.ts` | 提交 d100c62；`server/chat/exemplar-query.test.ts` 5 通过、`server/chat/service.test.ts` 84 通过 |

## WP12 把话带回真人、「我」这一侧

（共 14 条：✅ 6 · 🟡 8）

| 编号 | 一句话 | 状态 | 落点 | 验收依据 |
|---|---|---|---|---|
| C3.1 | 等待尺 | 🟡 | `shared/reply-delay.ts`、`client/src/components/v6/WaitGauge.tsx` | 提交 ac94c41；`shared/reply-delay.test.ts` 5 通过、`WaitGauge.test.tsx` 6 通过 |
| C3.2 | 排练室 | 🟡 | `shared/rehearsal.ts`、`client/src/pages/Rehearsal.tsx` | 提交 ab5b167、93dea5d、e0ae176；`shared/rehearsal.test.ts` 7 通过、`routers.rehearsal.test.ts` 11 通过；临时库四步与升级路径通过 |
| C3.3 | 出口常开 | ✅ | `client/src/components/MessageBubble.tsx`、`client/src/components/v6/OutboundEntry.tsx`、`client/src/components/v6/OutboundDrawer.tsx` | 提交 d5d6ae7；`server/routers.outbound.test.ts` 7 通过、`MessageBubble.test.tsx` 通过 |
| C3.4 | 读懂这一句 | 🟡 | `server/records/decode.ts`、`client/src/pages/Decode.tsx` | 提交 026d8b7、f737726；`server/records/decode.test.ts` 7 通过、`server/routers.record-decode.test.ts` 3 通过 |
| C3.5 | 说出口了 | ✅ | `client/src/components/OutboundLetters.tsx` | 提交 dfa8dc0；`routers.outbound.test.ts` 15 通过、`OutboundLetters.test.tsx` 20 通过；临时库四步与升级路径通过 |
| C3.6 | 措辞助手 | 🟡 | `shared/wording.ts`、`client/src/components/OutboundLetters.tsx`、`shared/copy/v6.ts` | 提交 4606468；`shared/wording.test.ts` 9 通过、`routers.outbound.test.ts` 通过；临时库四步与升级路径通过 |
| C3.7 | 见面清单 | ✅ | `client/src/components/LetterBox.tsx`、`client/src/components/v6/MeetDayNote.tsx` | 提交 85e42ff；`routers.letter-done.test.ts` 3 通过、`LetterBox.test.tsx` 14 通过；临时库四步与升级路径通过 |
| C4.1 | 镜子 | 🟡 | `shared/mirror.ts`、`client/src/pages/Mirror.tsx` | 提交 904322a、ebc4201；`shared/mirror.test.ts` 6 通过、`Mirror.test.tsx` 4 通过 |
| C4.2 | 聊完之后 | ✅ | `server/safety/checkins.ts`、`client/src/components/v6/AfterChat.tsx` | 提交 fa06008、cf86f46；`checkins.test.ts` 12 通过、`routers.checkin.test.ts` 4 通过；临时库四步与升级路径通过 |
| C4.3 | 情感健康趋势、毕业建议是怎么来的 | 🟡 | `client/src/components/v6/WellbeingTrends.tsx`、`client/src/components/v6/GraduationReasons.tsx` | 提交 61bdc2a、e0d8af8；`graduation-checkins.test.ts` 4 通过、`WellbeingTrends.test.tsx` 3 通过 |
| C4.4 | 角色互换 | 🟡 | `client/src/pages/Roleplay.tsx`、`server/chat/roleplay.ts` | 提交 e05ab99、9a7b266；`chat/roleplay.test.ts` 4 通过、`routers.roleplay.test.ts` 9 通过；临时库四步与升级路径通过 |
| C4.5 | 自己的日记 | ✅ | `client/src/components/v6/MyJournal.tsx`、`client/src/components/v6/PersonalTimeline.tsx` | 提交 f98561b、ca77708；`routers.journal.test.ts` 4 通过、`journal-no-model.test.ts` 通过；临时库四步与升级路径通过 |
| C4.6 | 带去给咨询师 | 🟡 | `server/_core/export-html.ts`、`client/src/components/v6/CounselorExport.tsx` | 提交 6c9f0f8、74f9457；`export-html.test.ts` 15 通过、`routers.counselor.test.ts` 2 通过 |
| C10.4 | 不变成监视工具 | ✅ | `drizzle/schema.ts`、`server/scheduler/index.ts` | 提交 796cb87；`server/no-surveillance.test.ts` 5 通过 |

## WP13 异地、告别、悼念

（共 15 条：✅ 11 · 🟡 4）

| 编号 | 一句话 | 状态 | 落点 | 验收依据 |
|---|---|---|---|---|
| C5.1 | 见面倒计时 | ✅ | `shared/persona-state.ts`、`client/src/components/v6/MeetCountdown.tsx`、`client/src/components/v6/LdrSettings.tsx` | 提交 9bfe1a5；`shared/persona-state.test.ts` 11 通过、`MeetCountdown.test.tsx` 6 通过 |
| C5.2 | TA 那边 | ✅ | `shared/sun.ts`、`server/routers-v6/ldr.ts`、`client/src/components/v6/TheirSide.tsx` | 提交 2eb34ac；`shared/sun.test.ts` 12 通过、`server/routers-v6/ldr.test.ts` 7 通过 |
| C5.3 | 时间胶囊 | ✅ | `server/routers-v6/scheduled.ts`、`server/scheduler/scheduled-items.ts`、`client/src/components/v6/ScheduledList.tsx` | 提交 485369d；`server/db-scheduled.test.ts` 3 通过、`server/routers-v6/scheduled.test.ts` 8 通过；迁移 `0071_scheduled_items` 四步与升级路径通过 |
| C5.4 | 重新联系上那天 | ✅ | `client/src/components/v6/ReunionSummary.tsx`、`client/src/pages/PersonaProfile.tsx`、`client/src/pages/PersonaEdit.tsx` | 提交 2f7393a；`server/routers.reunion.test.ts` 6 通过、`ReunionSummary.test.tsx` 5 通过 |
| C5.5 | 邮件信箱 | ✅ | `server/_core/mail.ts`、`server/routers-v6/email.ts`、`server/chat/letters.ts` | 提交 54f7a3a、74427db；`server/_core/mail.test.ts` 11 通过、`server/routers-v6/email.test.ts` 5 通过 |
| C6.1 | 渐进式告别 | ✅ | `shared/persona-state.ts`、`server/chat/service.ts`、`server/channels/bridge.ts` | 提交 e42e7da；`shared/persona-state.test.ts` 11 通过、`server/chat/service.test.ts` 86 通过 |
| C6.2 | 封存 | ✅ | `shared/persona-state.ts`、`client/src/components/v6/SealSettings.tsx`、`client/src/pages/Lobby.tsx` | 提交 1e35222；`shared/persona-state.test.ts` 11 通过、`server/sealed-guard.test.ts` 7 通过 |
| C6.3 | 纪念册 | ✅ | `server/routers-v6/book.ts`、`client/src/pages/Book.tsx` | 提交 92e0975、86263c7；`server/routers-v6/book.test.ts` 5 通过、`client/src/pages/Book.test.tsx` 3 通过 |
| C6.4 | 留下三句话 | ✅ | `client/src/components/v6/KeepThree.tsx`、`client/src/pages/Graduation.tsx`、`client/src/pages/Lobby.tsx` | 提交 26e7798；`server/routers.kept-quotes.test.ts` 4 通过、`KeepThree.test.tsx` 2 通过 |
| C6.5 | 没说完的话、互相读信、毕业后回访 | 🟡 | `server/records/unsaid.ts`、`server/chat/unsaid.ts`、`server/routers-v6/unsaid.ts` | 提交 01c1994、31be290、b718e0c；`server/records/unsaid.test.ts` 4 通过、`server/chat/unsaid.test.ts` 3 通过 |
| C6.6 | 多种结局 | 🟡 | `server/chat/farewell.ts`、`client/src/components/v6/GraduationKindPicker.tsx`、`client/src/pages/Graduation.tsx` | 提交 974fd44；`server/farewell.test.ts` 12 通过、`GraduationKindPicker.test.tsx` 1 通过 |
| C7.1 | 悼念模式 | 🟡 | `shared/graduation-mode.ts`、`shared/proactive-decision.ts`、`server/chat/proactive-sweep.ts` | 提交 c7a9a4f、478aa2e；`server/graduation-mode.test.ts` 8 通过、`shared/proactive-decision.test.ts` 通过 |
| C7.2 | 家人共用一个分身 | ✅ | `server/routers-v6/share.ts`、`shared/persona-sharing.ts`、`server/chat/service.ts` | 提交 219e8af、6116eaa、b46a562；`server/db-sharing.test.ts` 1 通过、`server/routers-v6/share.test.ts` 6 通过 |
| C7.3 | 留声 | ✅ | `client/src/pages/Voices.tsx`、`client/src/components/v6/VoicesEntry.tsx`、`client/src/pages/PersonaProfile.tsx` | 提交 f6afa64；`client/src/pages/Voices.test.tsx` 11 通过、`client/src/components/v6/VoicesEntry.test.tsx` 2 通过 |
| C7.4 | 口述补全 | 🟡 | `shared/oral.ts`、`server/oral/extract.ts`、`server/routers-v6/oral.ts` | 提交 aa512b4、36e75bb、4fdc42e；`shared/oral.test.ts` 10 通过、`server/oral/extract.test.ts` 9 通过；迁移 `0073_oral_accounts` 四步与升级路径通过 |

## WP14 日常可用

（共 12 条：✅ 8 · 🟡 4）

| 编号 | 一句话 | 状态 | 落点 | 验收依据 |
|---|---|---|---|---|
| C1.8 | 没有记录的人 | 🟡 | `server/templates/interview.ts`、`server/routers-v6/interview.ts`、`shared/described.ts` | 提交 4c5c630、c78c48b；`server/templates/interview.test.ts` 通过、`server/routers-v6/interview.test.ts` 10 通过 |
| C8.2 | 全局信箱与未读 | ✅ | `client/src/pages/Letters.tsx`、`client/src/components/v6/MailboxEntry.tsx`、`server/scheduler/scheduled-items.ts` | 提交 7fb2705；`server/db-letter-inbox.test.ts` 3 通过、`server/routers.letter-inbox.test.ts` 9 通过；迁移 `0074_letter_inbox` 四步与升级路径通过 |
| C8.3 | 完整备份与还原 | ✅ | `server/_core/backup-format.ts`、`server/_core/backup-tables.ts`、`server/routers-v6/backup.ts` | 提交 4efb10e、f69d4b5；`server/_core/backup-format.test.ts` 通过、`server/_core/backup-tables.test.ts` 通过；迁移 `0080_user_backup_settings` 四步与升级路径通过 |
| C8.4 | 应用锁 | ✅ | `shared/lock.ts`、`server/_core/uploads.ts`、`server/chat/call.ts` | 提交 1f92bf1、0fd9813、723aa68；`shared/lock.test.ts` 6 通过、`server/lock.test.ts` 22 通过；迁移 `0081_app_lock` 四步与升级路径通过 |
| C8.5 | 静态加密 | ✅ | `server/_core/encrypted-values.ts`、`server/encryption/lock.ts`、`server/routers-v6/encryption.ts` | 提交 d8dd7bf、0eb8b5e、7b65893；`server/_core/encrypted-values.test.ts` 26 通过、`server/encryption/lock.test.ts` 11 通过；迁移 `0082_user_encryption` 四步与升级路径通过 |
| C8.8 | 原生外壳 | 🟡 | `client/src/pages/ShareInbox.tsx`、`client/src/pages/ChatLast.tsx` | 提交 d9caab6、7d72d6e、13c50e7；`client/src/lib/sw-privacy.test.ts` 14 通过、`server/pwa-copy.test.ts` 6 通过 |
| C8.9 | 成本面板 | 🟡 | `server/llm/usage.ts`、`server/llm/budget.ts`、`server/chat/generate.ts` | 提交 1920587、30561c4、5846be3；`server/db-llm-usage.test.ts` 4 通过、`server/llm/usage.test.ts` 12 通过；迁移 `0075_llm_usage` 四步与升级路径通过 |
| C8.10 | 对话管理 | ✅ | `server/routers-v6/mark.ts`、`server/chat/quoted-records.ts`、`server/chat/generate.ts` | 提交 774be7a、a073df8；`server/routers-v6/mark.test.ts` 10 通过、`server/chat/quoted-records.test.ts` 7 通过；迁移 `0077_message_marks` 四步与升级路径通过 |
| C8.11 | 撤销与回收站 | ✅ | `client/src/components/v6/UndoToast.tsx`、`client/src/components/v6/RecycleBin.tsx`、`client/src/components/v6/MemoryReview.tsx` | 提交 b38d7c6、97a22d6、2aa5045；`server/db-soft-delete.test.ts` 17 通过、`UndoToast.test.tsx` 4 通过；迁移 `0078_soft_delete` 四步与升级路径通过 |
| C8.12 | 一键诊断 | ✅ | `shared/system-diagnose.ts`、`client/src/components/v6/Diagnostics.tsx` | 提交 5f57c90、f1fc4cb；`server/system-diagnose.test.ts` 76 通过、`server/system-diagnose-router.test.ts` 7 通过 |
| C8.13 | 场景可编辑 | 🟡 | `shared/scene-range.ts`、`server/chat/scene-range.ts`、`client/src/components/v6/ScenePanel.tsx` | 提交 fedb246、3595964；`server/scenes-edit.test.ts` 14 通过、`shared/scene-range.test.ts` 8 通过；迁移 `0079_scene_record_range` 四步与升级路径通过 |
| C8.14 | 可访问性、繁体界面、英文情绪触发词 | ✅ | `client/src/components/v6/AccessibilitySettings.tsx`、`shared/han-normalize.ts`、`server/safety/crisis.ts` | 提交 b49f4a0、cdaa3ac、3d5194e；`AccessibilitySettings.test.tsx` 通过、`client/src/a11y.test.tsx` 通过 |

## WP15 通道与生态

（共 8 条：✅ 5 · 🟡 3）

| 编号 | 一句话 | 状态 | 落点 | 验收依据 |
|---|---|---|---|---|
| C9.1 | 更多通道 | 🟡 | `server/channels/binding.ts`、`server/channels/telegram.ts`、`server/channels/discord.ts` | 提交 73656e9、786348d、22a1578；`server/channels/binding.test.ts` 14 通过、`telegram.test.ts` 19 通过；迁移 `0084_more_channels` 四步与升级路径通过 |
| C9.2 | OpenAI 兼容端点 | ✅ | `server/chat/service.ts`、`server/_core/api-keys.ts`、`server/routers-v6/api-keys.ts` | 提交 c5a0d80、73b3dcd；`server/db-api-keys.test.ts` 4 通过、`server/openai-compat.test.ts` 21 通过；迁移 `0083_api_keys` 四步与升级路径通过 |
| C9.3 | MCP 服务 | ✅ | `scripts/mcp-server.ts`、`server/db.ts` | 提交 e0644d0、8c853fa；`server/mcp/mcp.test.ts` 23 通过、`mcp.test.ts` 通过 |
| C9.4 | 工具调用 | 🟡 | `server/llm/tools.ts`、`server/chat/persona-tools.ts`、`server/chat/checkin.ts` | 提交 2936e5a、774e50a、32ca485；`server/llm/providers/tools.test.ts` 13 通过、`server/llm/capabilities.test.ts` 5 通过 |
| C9.5 | 分身包 | ✅ | `server/_core/bundle.ts`、`server/personas/bundle-route.ts`、`client/src/components/v6/PersonaBundle.tsx` | 提交 4a52323、a096901、fef535e；`server/_core/bundle.test.ts` 8 通过、`server/personas/bundle-route.test.ts` 13 通过 |
| C9.6 | 命令行 | ✅ | `scripts/mirrai.ts`、`scripts/eval-run.ts`、`scripts/backup.ts` | 提交 9f8d97d；`scripts/mirrai.test.ts` 17 通过、`mirrai.test.ts` 通过 |
| C9.7 | 插件系统与文档站 | ✅ | `server/routers-v6/plugins.ts`、`server/routers-v6/import.ts`、`client/src/components/v6/Plugins.tsx` | 提交 e5df625、a0e0161、c08a776；`server/plugins/plugins.test.ts` 9 通过、`server/routers-v6/import.test.ts` 通过 |
| C9.8 | 群聊 | 🟡 | `client/src/pages/Group.tsx`、`client/src/components/v6/GroupRooms.tsx`、`client/src/components/v6/GroupChatSetting.tsx` | 提交 e201f1b、d13fdb0、65a5109；`server/db-groups.test.ts` 6 通过、`style-profile.test.ts` 通过；迁移 `0085_group_chat` 四步与升级路径通过 |

## WP16 安全与伦理

（共 5 条：✅ 4 · 🟡 1）

| 编号 | 一句话 | 状态 | 落点 | 验收依据 |
|---|---|---|---|---|
| C10.2 | 语义危机识别 | 🟡 | `server/safety/crisis-indirect.ts`、`server/safety/crisis-semantic.ts`、`server/safety/crisis.ts` | 提交 af75aec、bbf04ad；`crisis-indirect.test.ts` 11 通过、`crisis-semantic.test.ts` 8 通过 |
| C10.3 | 同意工具 | ✅ | `server/routers-v6/consent.ts`、`server/consent/purge.ts`、`server/chat/service.ts` | 提交 ef49f9c、8840df8、de777bc；`server/consent/purge-db.test.ts` 2 通过、`server/routers-v6/consent.test.ts` 10 通过；迁移 `0086_consent_removals` 四步与升级路径通过 |
| C10.5 | 深夜保护 | ✅ | `server/safety/usage-monitor.ts`、`server/chat/service.ts`、`client/src/pages/Chat.tsx` | 提交 1d93e00；`server/safety/usage-monitor.test.ts` 32 通过、`server/chat/service.test.ts` 100 通过 |
| C10.6 | 全局推断视图 | ✅ | `server/inference/list.ts`、`server/routers-v6/inference.ts`、`server/chat/generate.ts` | 提交 3a24703、6982579；`server/inference/list.test.ts` 9 通过、`server/routers-v6/inference.test.ts` 5 通过 |
| C10.7 | 重建标记 | ✅ | `server/records/provenance.ts`、`server/chat/service.ts`、`server/chat/reply-jobs.ts` | 提交 c95c483；`server/records/provenance.test.ts` 8 通过、`server/chat/service.test.ts` 103 通过 |

## WP17 模型层

（共 3 条：🟡 1 · 🔒 2）

| 编号 | 一句话 | 状态 | 落点 | 验收依据 |
|---|---|---|---|---|
| B9.1 | 本地适配器 | 🔒 | `server/eval/unlock-check.ts` | 提交 baaf8ab；`unlock-check.test.ts` 17 通过；只读、不调模型 |
| B9.2 | 浅融合 | 🔒 | `server/eval/unlock-check.ts` | 提交 baaf8ab；与 B9.1 共用 `--unlock-check`；不训练任何东西 |
| B9.3 | logit_bias 与形状约束 | 🟡 | `shared/style-fingerprint.ts`、`server/llm/logit-bias.ts`、`server/chat/generate.ts` | 提交 8625738、c228021；`shared/style-fingerprint.test.ts` 通过、`server/llm/logit-bias.test.ts` 13 通过 |

## WP18 收尾

（共 5 条：✅ 5）

| 编号 | 一句话 | 状态 | 落点 | 验收依据 |
|---|---|---|---|---|
| P18.1 | 文档对齐 | ✅ | `README.md`、`README.en.md`、`.env.example`、`docs/roadmap-v6.md`、`scripts/check-doc-links.mjs` | 提交 395162f、36f4c68、1b1800e；`server/env-example.test.ts` 3 通过、`server/egress.test.ts` 5 通过；闸门七步全绿（725 文件 / 6080 用例 / 122 跳过） |
| P18.2 | 一次从头到尾的冒烟 | ✅ | `scripts/live-stub-model.mjs`、`docs/exec-v6-progress.md` | 草稿库 `mirrai_v6_p182` 上七步全走完；「晚安」桩请求 +0、第二分身记录 4904=4904；提交 5990358（只有批次日志） |
| P18.3 | 整体复验 | ✅ | `scripts/gate-all.mjs`、`docs/exec-v6-progress.md` | 干净树 `fd3cdd7` 上重跑：闸门七步、数据库四步（84 条迁移 / `--replay` / `--rollback 1`）、带库全量 725 文件 6081 用例 0 跳过、静态项全过；发现并修测试隔离问题（e198858）；提交 053f17f |
| P18.4 | 独立抽查 | ✅ | `docs/exec-v6-progress.md` | 2026-11-27 由独立验收会话完成：19 个工作包各抽 3 条（`sha256("exec-v6\|WP<n>\|<编号>")` 升序）+ 14 条必查，去重 66 条从头重跑全部通过；开工/收尾闸门 725 文件 6081 用例 122 跳过；无条目降级；4 条低影响跟进项同日修复（提交 738b228、02b25d6、b5e402d、da7ce1d，偏差 605–608）；名单、38 条抽样/必查集里的边界试验（B3.5 无记录，可核 37/38）与发现见进度文件批次日志 |
| P18.5 | 交接 | ✅ | `docs/releases/v1.4.0-draft.md`、`docs/exec-v6-progress.md` | 发布说明草稿、给用户的摘要（状态条数/未验证清单全文/待决定全文/核心命令）、最终确认；提交见进度表 P18.5 行 |

---

## 怎么读这张表 / 还有哪些没做

- 每行的「验收依据」只写提交号（最多 3 个）、最关键的测试文件与通过数、以及数据库迁移四步这类一句话。完整的证据、闸门数字与批次记录在 [`exec-v6-progress.md`](exec-v6-progress.md) 的进度表；两边冲突时以进度表为准。
- 「落点」取自每条建议的「做法」和进度表证据里出现的模块，只列 1–3 个最关键的，不是完整改动清单；测试文件放在「验收依据」里，不占落点。
- 🟡 的 81 条逐条缺什么、该跑哪条命令、谁来跑，在进度文件的「未验证清单」；本机为什么最高只能到 🟡，见上一节。
- 还没定的九处在进度文件的「待用户决定」：A7 毕业资格里的连续天数、C8.3 首次启动的「新建还是还原」、C8.8 手机原生壳与系统推送、C8.5 加密账号下的家庭共享、C9.1 QQ 与企业微信、C9.7 插件通道的枚举值、C9.8 群聊加密与每天条数上限、B9.1/B9.2 是否另开阶段做本地适配器。
- 实现与手册不一致的地方在进度文件的「偏差表」（609 条）；影响大的几条按 P18.5 的摘要再列一次。
- WP18 的 P18.4（独立抽查）已在 2026-11-27 完成：不带实施上下文，按工作包各抽 3 条（SHA-256 种子）重新跑验收，并必查 A1、A2、A8、B1.1、B2.1、B2.2、B5.1、B5.2、C7.2、C8.3、C8.5、C8.11、C10.1、C10.3；去重后 66 条全部通过，没有条目降级，详细名单与逐条证据在进度文件的批次日志。P18.5 照 [`v1.3.0.md`](releases/v1.3.0.md) 的写法写了发布说明草稿，没改版本号、没打标签。
- 盲测记录按 [`baseline.md`](eval/baseline.md) 的约定；本阶段还没有真人被试做过盲测，「真人盲测命中率」这一项仍是未验证。
