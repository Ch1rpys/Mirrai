# 第六阶段进度

## 基线（2026-11-16，提交 b3710ef；对照 main @ 4adc434 / 当前 main HEAD f71e77b）

在 `exec/v6` 上、提交两份文档之后、改任何生产代码之前跑的。命令与手册第 2.1 / 2.3 节相同。

| 检查 | 结果 |
|---|---|
| `tsc --noEmit` | 退出码 0，无输出 |
| `vitest run` | 259 个文件：257 通过、2 跳过；2494 个用例：2486 通过、8 跳过（跳过的 8 个需要数据库） |
| 带 `DATABASE_URL` 跑 `server/db-unique-indexes.test.ts` 与 `server/collectors/idempotency-db.test.ts` | 2 个文件、8 个用例全过 |
| `audit-cn.ts` | `0 Chinese strings without an English counterpart, in 0 files.` |
| `fidelity-gate.ts` | 7 条 ✓ |
| 客户端构建 `vite build` | 退出码 0，`✓ built in 5.24s` |
| 服务端打包 esbuild | 退出码 0，`dist/index.js  1.2mb` |
| `migrate.mjs --replay`（临时库 `mirrai_v6_scratch`，用完已 `dropdb`） | skipping 2 无标记文件；replayed 41 migration(s) — all of them ran again |

与手册第 2.2 节一致。当前 `main` HEAD 是 `f71e77b`（手册写作基线 `4adc434` 之后还有文档类提交），闸门数字没有变。

## 进度表

| 编号 | 状态 | 提交 | 验收证据 |
|---|---|---|---|
| P0.1 | ✅ | b3710ef (docs); 2fe5653 (progress) | `git branch --show-current` → `exec/v6`. `git log --oneline main..exec/v6` 第一个提交 `b3710ef` 只含 `docs/ideas-v6.md` 和 `docs/exec-v6.md`。基线见上表，与 §2.2 一致。进度表 176 行。 |
| P0.2 | ✅ | b298550 | `corepack pnpm gate` 退出码 0，输出 `all six steps passed`（typecheck / test 258 passed \| 2 skipped, 2489 passed \| 8 skipped / copy-audit / fidelity-gate / client-build / server-bundle）。`server/gate-script.test.ts` 3 通过。故意在 `server/_core/fidelity-gate.ts` 加 `const __p02TypeError: number = "intentionally-wrong"` 后 `corepack pnpm gate` 退出码 2，输出 `[gate] failed at typecheck (exit 2, 1.8s)`；`git checkout HEAD -- server/_core/fidelity-gate.ts` 改回。 |
| P0.3 | ✅ | e506484 | `server/chat/prompt-golden.test.ts` 10 通过；快照文件 9 份 `exports[`. 改 `shared/copy/prompt.ts` 的 `prompt.identityVolunteers` zh「【AI 身份】」为「【AI 身份x】」后 8 个快照红（`Snapshot mismatched`）；`git checkout HEAD -- shared/copy/prompt.ts` 后 10 通过。`corepack pnpm gate` 全绿：259 passed \| 2 skipped (261)，2499 passed \| 8 skipped (2507)。 |
| P0.4 | ✅ | 1e44f5d (data); e59ec6d (routes/UI) | 临时库四步+升级路径：rollback 后 `settings`/`styleProfile` 消失，再 migrate 回来；升级路径 DROP 两列并删 `schema_migrations` 的 0044 后再 migrate，两列出现。`shared/persona-settings.test.ts` 5 通过（空值默认、`twoStage: "yes"` 回落、未知键丢弃、`maxDelayMinutes: 9999` 钳到 360、深合并）。`server/routers.persona-settings.test.ts` 3 通过（别人的分身 `NOT_FOUND`、patch 后读回、`withPersonaDataLock` 源码位置）。`server/schema-coverage.test.ts`、`schema-parity.test.ts` 通过。P0.3 黄金快照 10 通过未改。`corepack pnpm gate` 全绿：264 passed \| 2 skipped (266)，2514 passed \| 8 skipped (2522)。 |
| P0.5 | ✅ | b1fe349; c785e6a; 34f5564 | `34f5564` 修复验的两处：冲突不排在周三，从「就嗯？」到第一句和好正好是 3、4、5、5、6、8 小时，这段里没有别的消息。`xiaoman.test.ts` 35 通过。闸门 `269 passed \| 2 skipped (271)`，`2562 passed \| 8 skipped (2570)`。 |
| P0.6 | ✅ | 1588608 (move); b089be8 (eval); 58d1123 (tests) | `server/chat/service.test.ts`、`stream.test.ts`、`fidelity-prompt.test.ts`、`server/eval/run.test.ts`、`server/routers.eval.test.ts`、`server/eval/compare-cli.test.ts` 未改文件、全部通过。P0.3 `prompt-golden.test.ts` 10 通过、快照未改。`server/chat/generate.test.ts`：同一分身/上下文/`now`，`runConversation` 与 `runEval` 发给 provider 的 `messages` 去掉留出句后 `toEqual`；`layerOverridesForEval({ without: ["act"] })` 后 `sampledAct` 为 `null`、`layersUsed` 不含 `act`。`scripts/eval-run.ts` 含 `--without`。搬家后闸门 266 passed \| 2 skipped (268)，2553 passed \| 8 skipped (2561)；评测接入后 267 passed \| 2 skipped (269)，2557 passed \| 8 skipped (2565)。 |
| P0.7 | ✅ | 16ad889; e6e22c1 (scan) | `server/egress.test.ts` 4 通过：`server/` 生产文件里每一处 `fetch(` / `new WebSocket(` / `http(s).request(` 都在白名单；在 `server/llm/index.ts` 加 `fetch("https://example.com")` 后失败，输出 `missing: ['server/llm/index.ts']`；删掉后 4 通过。`docs/egress.md` 表体 14 行 = `EGRESS_ITEMS.length`。`EgressList.test.tsx`：每一项的「连到哪」「发什么」和「默认开/关」都渲染出来。`corepack pnpm gate` 全绿：269 passed \| 2 skipped (271)，2562 passed \| 8 skipped (2570)。 |
| A1 | ✅ | 6cf669d (schema/helpers); c017aed (write/upload); 6736dc3 (readers); 3d66751 (backfill/banner) | 临时库 `mirrai_v6_scratch`：`drizzle-kit push --force` 后 `migrate.mjs` 应用到 0045；`server/db-records.test.ts` 5 通过（夹具条数=`countRecords`、`iterateRecords` 分页同数且时间升序、同一秒两条「嗯」都在、`register: "all"` 计 2、再 `importRecords` 同一份夹具写入 0）；库已 `dropdb`。`server/routers.file-upload-import.test.ts`：`createCollectedMessages` mock 收到 `fileId: 99`、`lineNo` 1/2、`kind: "text"`、`speaker` 小满/阿树。`server/chat/exemplars-upload.test.ts` 2 通过：未导入时提示词不含 `prompt.exemplarsHeading`；上传导入后含该标题和「在的呀」，且 `getCollectedMessagesForPersona` 带 `{ newest: true }`。`server/records-readers.test.ts` 6 通过（prompt/generate/behavior-profile/routers/eval-run.ts 无调用/eval CLI）。P0.3 `prompt-golden.test.ts` 10 通过、快照未改。`server/routers-v6/import.test.ts`：别人的分身 `NOT_FOUND`；未解析的 txt 从磁盘读入、不读 `extractedMemory`。`BackfillBanner.test.tsx`：count=0 不渲染；count=2 显示横幅和「现在整理」。闸门 `278 passed \| 3 skipped (281)` 文件，`2604 passed \| 13 skipped (2617)` 用例，`all six steps passed`。 |
| A2 | ✅ | 042d0bf (with A4 normalize) | `roles.test.ts` 3 通过：两个具名说话人且一个是 TA → 另一人 `user`；三个具名说话人 → 非 TA 为 `other`；无说话人 → 全是 `other`。`pipeline-v5-seam.test.ts` 文本路径：旧代码 `actProfile` 为 `null`（`expected null to be truthy`）；改映射后与 A4 同一条断言绿。闸门随 A4。 |
| A3 | ✅ | 267d8c6 (with C1.2 wizard) | `csv-not-unlabelled.test.ts`：`renderFixture(buildXiaomanRecords(), "wechat-csv")` 经 wechat-csv 解析再 `guessRoles`/`assignRoles`，每行 `role` 为 `user` 或 `assistant`，`content` 不含 `IsSender`/`StrContent`/`StrTime`，`lineNo > 1`。先红后绿见偏差 40。闸门随 C1.2。 |
| A4 | ✅ | 042d0bf (normalize); 507c44c (records) | `pipeline-v5-seam.test.ts` 2 通过。文本路径与 `records` 路径：`actProfile.samples ≥ 40`；相邻两段 `to`/`from` 同为静默后第一条的 ISO（夹具 p2 首条 `2023-07-12T08:16:09.000Z`）；该段 `suppressionsDelta` 含 `no_question_ending`；`openingProfile.samples > 0`；「下次带你去吃那家面」`whoSaid=them`，「说好的 周末看电影」`whoSaid=me`。先红后绿：提交 `042d0bf` 之前跑同一文件，`actProfile` 为 `null`。`db-store.test.ts` `toTimedTranscript`：`2023-07-12T08:16:09.000Z` + `Asia/Shanghai` → `2023-07-12 16:16 我：在吗`。`server/skill-engine/` 原有测试 + `prompt-golden.test.ts` 10 通过、快照未改。闸门 `303 passed \| 3 skipped (306)` 文件，`2796 passed \| 13 skipped (2809)` 用例。时期条数见偏差 46。 |
| A5 | ✅ | 21981ee | 先红后绿：`Lobby.test.tsx` `does not put a daily letter in a persona's mouth` 旧代码红在 `expected <h2 class="section-title">TA 想对你说</h2> to be null`；改后该文件 11 通过。`rg -n "lobby\\.daily|DailyMessages" client/` 无结果。`i18n.test.ts` 与 Lobby 一起 26 通过。闸门 `310 passed \| 3 skipped (313)` 文件，`2837 passed \| 16 skipped (2853)` 用例，`all six steps passed`。 |
| A6 | ✅ | 8614668; d9f679d (quotes) | 先红后绿：`Lobby.test.tsx` 三条在改代码前红——quiet 分身页面有「很想你」；`getByRole("heading", { name: "接着聊" })` 找不到推荐标题；卡片没有「上次联系 3 天前」。改后该文件 14 通过。`lobby-eligibility.test.ts` 5 通过（未就绪 / 已毕业 / quiet / unreachable / relationshipEnded 各一条反例）。`db-behaviour.test.ts`：`relationship_events` 一次 `DISTINCT ON (personaId)`，breakup 与 `togetherTo` 都令 `relationshipEnded` 为真。`rg -n "missYou|getMissYouLevel" client/` 无结果。闸门 `311 passed \| 3 skipped (314)` 文件，`2847 passed \| 16 skipped (2863)` 用例。 |
| A7 | ✅ | 8ceb9b8 (remove); 3b5575e (milestones) | 先红后绿：`Lobby.test.tsx` `does not keep a streak, achievement badges, or a conversation ranking` 旧代码红在 `expected '连续对话 2 天' not to be null`；改后该文件 15 通过。`Analytics.test.tsx` `does not keep a longest-streak tile` 无「最长连续」。`rg -n "ChatStreak\|AchievementBadges\|PersonaLeaderboard\|ACHIEVEMENTS" client/` 无结果。`Milestones.test.tsx` 3 通过：三日期都 null 不渲染；只有 `firstLetterAt` 时只出现「写下了第一封信」。`routers.milestones.test.ts` 2 通过：user 1 / 2 各自只看到自己的日期，procedure 调 `getUserMilestones(ctx.user.id)`。`1e5dec4`：`db-behaviour.test.ts` 断言三条 SQL 分别按 `letters.userId` 且 `kind = letter`、`outbound_letters.userId`、`personas.userId` 过滤。闸门 `313 passed \| 3 skipped (316)` 文件，`2854 passed \| 16 skipped (2870)` 用例。 |
| A8 | ✅ | 2cfd462 (extract); 0be929c (review); d14ba9d (upload prompt) | 先红后绿：`memory-extract-source.test.ts` `does not store a fact the persona said` 旧代码红在 `createMemory` 被调用、`fromPersona` 为 undefined。改后该文件 4 通过（分身行不存 / 用户行存 / 无 line 丢弃 / 上传记录里 TA 的行照常存）。`memory-extract.test.ts` 与 `memory-extract.test.ts`（根下）通过；原有 mock 补了 `line`。`MemoryReview.test.tsx` 3 通过：空列表不渲染；「留着」调 `keepFromPersona({ id: 7 })`；「删掉」调 `delete({ id: 7 })`。闸门 `315 passed \| 3 skipped (318)` 文件，`2861 passed \| 16 skipped (2877)` 用例。 |
| A9 | ✅ | 6ebeea3 | 四条都核到了，`KNOWN_UNVERIFIED` 为空，未验证清单无 A9 行。`resources.test.ts` 6 通过（含 source 以 `https://` 开头、`lastVerified` 不是 `2026-01-01`、KNOWN_UNVERIFIED 与进度未验证清单一致）。`egress.test.ts` 4 通过。闸门 `315 passed \| 3 skipped (318)` 文件，`2863 passed \| 16 skipped (2879)` 用例。核对摘要见批次日志。 |
| B1.1 | ✅ | 93aa60d (schema); 1fd5c18 (chunks); 14faa43 (map); a488610 (reduce); e15dc9a (estimate) | 临时库 `mirrai_v6_scratch` 0046 四步+升级路径：`push --force` 后 `migrate` 应用到 `0046_distillation_tables`（journal 44 条）；`--replay` `replayed 44 migration(s)`；`--rollback 1` 后三张表和 memories/records 新列消失；再 `migrate` 回来。升级路径 DROP 三表七列并删 journal 的 0046 后再 migrate，对象出现。库已 `dropdb`。`chunks.test.ts` 6 通过：不跨 2023-06-10 静默、每块 ≤ `CHUNK_MAX_CHARS`、两次 hash 相同、说话行各进一块、deep 预估块数=切块数、fast 预估 12 块。`pipeline-chunked.test.ts` 7 通过：deep map=块数、fast=12、坏引用不入库、expression 只引「我」丢弃、归并不含 `#\d+ ` 只含卡片、构建文案最近段标「（现在）」、失败超三成 `analysisStatus: error` 且含「三成」、技能包无 `#\d+`。`routers.skill-engine.test.ts`：`estimate` 块数与 `chunkRecords` 一致；`MAX_DISTILL_CALLS=1` 时 `triggerAnalysis` 抛 `/上限/`。`pipeline.test.ts` 5 通过（mock 补了三个导出，见偏差 64）。`Upload.test.tsx` 显示「这次会读 24 段…31 次」、120 次时确认可停。闸门 `318 passed \| 3 skipped (321)` 文件，`2897 passed \| 16 skipped (2913)` 用例。 |
| B1.2 | ✅ | dbd08ca; 99e8b2f (mood) | `chunks.test.ts` `selectChunks` 3 通过：budget 12 含第 1 块和最后 3 块、两个时期、白天和夜里、同一种子两次 hash 相同；budget > 块数返回全部；最晚一块的 `to` ≥ 记录时间跨度的 95%。闸门 `318 passed \| 3 skipped (321)` 文件，`2900 passed \| 16 skipped (2916)` 用例。情绪维等 B1.5。 |
| B1.3 | ✅ | c1e9484 (parse/cues); ce3c3d9 (pipeline) | `memory-date.test.ts` 3 通过（`2021-05-21`/`05-21` 真，`02-30`/`last summer` 假）。`fact-cues.test.ts` 3 通过（「我生日是5月21号」命中，「在的呀」不命中）。`facts.test.ts` 8 通过：合法引用入库、跨块行号丢弃、非法日期置空、deep 读全部块、fast 不调无线索块、`createMemory` `category: anchor` `date: 05-21` `recordId: 11` `source: records`、同一事实第二次 `created: 0`。`pipeline-chunked.test.ts` 生日那条 `createMemory` 含 `anchor`/`05-21`/`records`；fast 无线索块的 `#id` 不在 fact 调用里；quote 999999 不入库；两遍蒸馏 `store.length` 不变。`retrieval.test.ts` `source: "records"` 时 `getFileSummariesByPersonaId` 未调用。闸门 `321 passed \| 3 skipped (324)` 文件，`2920 passed \| 16 skipped (2936)` 用例。 |
| B1.4 | ✅ | 89d0048 (rules); ade38b6 (label/pipeline) | 先红后绿：旧 `buildActProfile` 300 轮规则判不了的回复进入分布 80 条，断言 `samples > 200` 红在 `expected 80 to be greater than 200`。新路径 `labelActsForRecords` + 读已标注行：`acts-coverage.test.ts` 2 通过，standard 下 300 条全进分布；p2 只含 p2 行、真值 mock 后 `acknowledge` 占比在 0.3 ±5pp。`speech-acts.test.ts`：`precisionOnly` 下「我今天去了图书馆」为 `null`（旧规则 `share`）；`labelUserActByRule` 对「在吗」「嗯」「对不起」「想你」和普通陈述符合验收。`label-acts.test.ts` 同一批第二次模型调用 0；围栏内才有配对原文。`shared/act-profile.test.ts`、`server/eval/act-labels.test.ts` 通过。闸门 `323 passed \| 3 skipped (326)` 文件，`2931 passed \| 16 skipped (2947)` 用例。 |
| B1.5 | ✅ | db75f76 | 先红后绿：未回标时 `buildActProfile` 的桶没有 `emotion`（旧代码全是 `warm`），断言存在 `emotion: "distant"` 的桶为红。`act-buckets-emotion.test.ts` 3 通过：真值 mock 后有 `distant` 桶且样本 > 0；`countsForCondition` 对该条件 `fallback === false`；designed distant 场景里 TA 行全部 `emotion: "distant"`、用户行没有；`fast` 不调模型；无触发词且不调模型时 `emotion` 为空；同一批第二次调用 0。闸门 `324 passed \| 3 skipped (327)` 文件，`2935 passed \| 16 skipped (2951)` 用例。 |
| B1.6 | ✅ | 4709167 (pick/apply); ada73e8 (routes/UI) | `shared/clarify.test.ts` 22 通过：表中每题触发正反例；各回答补丁符合表；「不确定」只记 `clarified`、无内容补丁；数据齐全的夹具只问 `never_says`、`avoid_topic`、`confirm_rule:r-one`。`routers.clarify.test.ts` 3 通过：`address_angry` 写入 `source: "manual"` `verified: true`；重复回答 `BAD_REQUEST`；写在 `withPersonaDataLock` 里。`ClarifyCard.test.tsx` 2 通过：记下后前进；跳过不调 mutation。`prompt-fences.test.ts` `a line they would never say`：敌意文本只在 `<persona_data>` 围栏内。`pipeline-decisions.test.ts` 重跑保住 `clarified`。闸门 `333 passed \| 3 skipped (336)` 文件，`2986 passed \| 16 skipped (3002)` 用例。 |
| B1.7 | ✅ | 8499939 | `pipeline-chunked.test.ts`：同一份记录蒸两次，第二次 map 0 次、归并次数与第一次相同；追加 400 行后 map 次数等于 `chunkRecords` 里 hash 不在上次切块集合中的块数；第二次之后 `cardRows` 的 `chunkHash` 都在当前切块集合里。`observations.test.ts` 已读过的块不调模型。闸门 `333 passed \| 3 skipped (336)` 文件，`2990 passed \| 16 skipped (3006)` 用例。 |
| B1.8 | ✅ | 420ef23 | `shared/evidence-map.test.ts` 4 通过：字段-维度对应、缺 `recordId` 的引用丢弃、每维最多 30 张且时间倒序、`attachmentStyle`/`loveLanguage` 恒推断。`routers.evidence.test.ts` 2 通过：原话按 `recordId` 对上「在的呀」、别人的分身 `NOT_FOUND`。`EvidenceList.test.tsx` 2 通过：有卡可展开短句；`attachmentStyle` 恒「推断」。`PersonaProfile.test.tsx`：老分身 8 层都标「推断」且无展开按钮；`attachmentStyle` 有推断无依据按钮。闸门 `336 passed \| 3 skipped (339)` 文件，`3000 passed \| 16 skipped (3016)` 用例。 |
| B1.9 | ✅ | f965f92 (db); 298a524 (routes/UI); 77b0421 (both snapshots) | 临时库 `mirrai_v6_scratch` 上 `db-persona-versions.test.ts` 2 通过：蒸馏写回前后各一版（前「短句」、后「更短」）；第 21 版写入后最旧一版被清掉。库已 `dropdb`。`persona-version.test.ts` 4 通过：`restore` 后 `personaData` 等于那一版、新增 `reason: "restore"`；别人的版本 `NOT_FOUND`；改了 `speakingStyle` 的两版 diff 旧值「短句」现值「更短」。`db-delete-coverage.test.ts` 通过。`VersionHistory.test.tsx`：点恢复出确认框，确认后 `restore({ id: 5, versionId: 10 })`。闸门 `338 passed \| 4 skipped (342)` 文件，`3006 passed \| 18 skipped (3024)` 用例。 |
| B1.10 | ✅ | 26df59c | `shared/user-side-profile.test.ts` 2 通过：48 条用户文本 `samples` 相等、`sampleLines` 恰好 12 句且都是用户原话；39 条返回 `null`。`generate.test.ts`：`planTurn` 的 `messages` 不含 `sampleLines` 里那句独特原话。`measureStyleProfile` 写入 `styleProfile.userSide`。指纹等 B3.1。闸门 `339 passed \| 4 skipped (343)` 文件，`3009 passed \| 18 skipped (3027)` 用例。 |
| B2.1 | ⬜ |  |  |
| B2.2 | ⬜ |  |  |
| B2.3 | ⬜ |  |  |
| B2.4 | ⬜ |  |  |
| B2.5 | ⬜ |  |  |
| B2.6 | ⬜ |  |  |
| B2.7 | ⬜ |  |  |
| B2.8 | ⬜ |  |  |
| B2.9 | ⬜ |  |  |
| B3.1 | ✅ | 00d6e7a (measure); e774ee2 (UI) | `shared/style-fingerprint.test.ts` 24 通过：`endingClassOf` 每类至少两个用例（含「好的。。。」ellipsis、「好的。」period、「好的」other、「好呀~」tilde、「好呀」particle）；夹具 `endings.period` 在 distant 占比×0.9 的 ±0.02 内；`laugh.haRuns[4]` 最大；`ellipsisForms.unicode === 0`；`emoji.rate === 0`；39 行返回 `null`；`perState.distant.endings.period` 在 0.9±0.05，`warm.endings.period === 0`，distant 有「陈树」、warm 没有；`perPeriod` p1/p2 中位字数 10±1 与 6±1。`FingerprintView.test.tsx` 2 通过：夹具渲染「几乎不以句号结尾」；句号占多数时该项不出现。闸门 `341 passed \| 4 skipped (345)` 文件，`3037 passed \| 18 skipped (3055)` 用例。`particles["呢"]` 与 `haRuns` 仅长度 4 见偏差 70、71。 |
| B3.2 | ✅ | 2e05643 | `shared/style-fingerprint.test.ts`：`is small when the generated lines are the person's own` 通过（夹具 200 句 `total < 0.1`；末尾加「。」后 `endings > 0.5` 且 `total` 变大；80 字长句 `length === 1`）；`treats a period line as more surprising in warm than in distant` 通过。「哦。」对 warm 的 `lineSurprise` 大于 distant。`metrics.test.ts`：`fills styleDistance when a fingerprint is given` 通过；`leaves styleDistance null when there is no fingerprint` 通过，且 overlap / likelihoodGap / emotionAccuracy / cases / lengthDistance 与有指纹时相同。`compare-cli.test.ts`：`includes style in the comparison` 通过（源码含 `row("style"`、`[eval] style`、`tolerance-style`）。闸门 `341 passed \| 4 skipped (345)` 文件，`3042 passed \| 18 skipped (3060)` 用例，`all six steps passed`。 |
| B3.3 | ⬜ |  |  |
| B3.4 | ⬜ |  |  |
| B3.5 | ⬜ |  |  |
| B3.6 | ⬜ |  |  |
| B3.7 | ⬜ |  |  |
| B3.8 | ⬜ |  |  |
| B4.1 | ⬜ |  |  |
| B4.2 | ⬜ |  |  |
| B4.3 | ⬜ |  |  |
| B4.4 | ⬜ |  |  |
| B4.5 | ⬜ |  |  |
| B4.6 | ⬜ |  |  |
| B4.7 | ⬜ |  |  |
| B4.8 | ⬜ |  |  |
| B5.1 | ⬜ |  |  |
| B5.2 | ⬜ |  |  |
| B5.3 | ⬜ |  |  |
| B5.4 | ⬜ |  |  |
| B5.5 | ⬜ |  |  |
| B5.6 | ⬜ |  |  |
| B5.7 | ⬜ |  |  |
| B5.8 | ⬜ |  |  |
| B6.1 | ⬜ |  |  |
| B6.2 | ⬜ |  |  |
| B6.3 | ⬜ |  |  |
| B6.4 | ⬜ |  |  |
| B6.5 | ⬜ |  |  |
| B6.6 | ⬜ |  |  |
| B6.7 | ⬜ |  |  |
| B6.8 | ⬜ |  |  |
| B6.9 | ⬜ |  |  |
| B7.1 | ⬜ |  |  |
| B7.2 | ⬜ |  |  |
| B7.3 | ⬜ |  |  |
| B7.4 | ⬜ |  |  |
| B7.5 | ⬜ |  |  |
| B7.6 | ⬜ |  |  |
| B7.7 | ⛔ |  |  |
| B7.8 | ⬜ |  |  |
| B7.9 | ⬜ |  |  |
| B7.10 | ⬜ |  |  |
| B7.11 | ⬜ |  |  |
| B7.12 | ⬜ |  |  |
| B7.13 | ⬜ |  |  |
| B7.14 | ⬜ |  |  |
| B7.15 | ⬜ |  |  |
| B8.1 | ✅ | e61eca3 (model); cc0fa59 (CLI/UI) | `discriminator.test.ts`：200 句真句 vs 末尾加「。」AUC > 0.95，前三特征含 `ending.period` 且 `side === "persona"`；同一池随机对分 AUC 在 0.4–0.6；59 对 `insufficient` 且不训练；同输入同种子两次 AUC 全等；`splitPairFolds` 同一对不会跨训练/测试折。`compare-cli.test.ts`：源码含 `--discriminator`、`pairsFromEvalRuns(historical, version?.createdAt ?? null)`。`DiscriminatorView.test.tsx` 渲染「以句号结尾」和 AUC 文案；59 对显示「样本不够（59 / 60）。」。`FidelityPanel.test.tsx`：最近一次带 `metricsJson.discriminator` 时显示 AUC。闸门 `343 passed \| 4 skipped (347)` 文件，`3067 passed \| 18 skipped (3085)` 用例。特征 id 见偏差 73。 |
| B8.2 | ✅ | c74ebb7 (server); 906d812 (page); 9936193 (guest) | `routers.blind.test.ts`：`does not tell the sitter which line is real` 序列化不含 `real`/`said`/`expected`/`generated`；别人的分身 `NOT_FOUND`；对子不足返回「先跑一次评测。」。访客：坏 token `NOT_FOUND`、过期/已完成拒绝；token A 不能写进另一场；第 11 次 `guestLoad` 为 `TOO_MANY_REQUESTS`。`finish` 三比例之和为 1。`exportRecord` 不含原文「我今天去了拾光咖啡喝桂花拿铁」。`BlindTest.test.tsx` / `BlindGuest.test.tsx`：答完一组才出现下一组，全部答完才出现结果。临时库 `mirrai_v6_scratch` 0048 四步+升级路径：push 后 migrate 应用到 `0048_blind_sessions`；`--replay` `replayed 46 migration(s)`；`--rollback 1` 后无 `blind_sessions`；再 migrate 回来；DROP 表并删 journal 后再 migrate，表出现。库已 `dropdb`。`db-delete-coverage` 通过。`git show c74ebb7 -- docs/eval/blind-test.md` 只有追加。闸门 `347 passed \| 4 skipped (351)` 文件，`3087 passed \| 18 skipped (3105)` 用例。 |
| B8.3 | ✅ | 9babf31 | `drift.test.ts`：`rises after twenty in-character turns, and does not write` 通过，`slope > 0`、`firstWindowOver === 2`、写库 helper 0 次；`stays flat when every reply is one of theirs` 通过，`|slope| < 0.01`、`firstWindowOver === null`。`puts the sample lines inside the material fence` 与 `prompt-fences.test.ts` `keeps the other person's lines inside the fence`：`sampleLines` 只在 `MATERIAL>>>` 围栏内。`compare-cli.test.ts`：源码含 `--drift`、`variant: "drift"`。闸门 `348 passed \| 4 skipped (352)` 文件，`3094 passed \| 18 skipped (3112)` 用例。 |
| B8.4 | ✅ | 55f47b3 (server); 2e5314b (UI) | `audition.test.ts`：三个 mock provider，回 TA 原话的排第一；抛错的结果带 `eval.audition.failed`，整体未中断。`routers.eval.test.ts`：并发第二次 `CONFLICT`；别人的分身 `NOT_FOUND`。`AuditionView.test.tsx`：表按综合分降序（openai 在 long 前）；点「给这个分身用它」调用 `persona.update({ id: 7, llmProvider: "openai" })`。`compare-cli.test.ts`：源码含 `--audition`。闸门 `350 passed \| 4 skipped (354)` 文件，`3101 passed \| 18 skipped (3119)` 用例。额外查询 `eval.auditionInfo` 见偏差 74。 |
| B8.5 | ✅ | 23bd6fc | `compare-cli.test.ts`：`calls a layer that hurts when off a contribution, and an unchanged one noise` 通过，关 `rules` 后 overlap 0.55→0.20 为「有贡献」，关 `exemplars` 不变为「在噪声之内」；只有老五层时表 5 行。`does not call the model without --yes`：源码含 `if (!yes)`、`ablation would make`、`pass --yes to run`。闸门 `350 passed \| 4 skipped (354)` 文件，`3103 passed \| 18 skipped (3121)` 用例。 |
| B8.6 | ✅ | 9c13769 | `metrics.test.ts`：`gives the same interval when the same scores are aggregated twice` 通过；`collapses the interval to a point when there is only one case` 通过。`compare-cli.test.ts`：`calls overlapping intervals within noise` 通过；`calls a separated improvement better` 通过。`run.test.ts`：`generates k lines for each case when asked` 通过，`samplesPerCase: 3` 时 2 个标答 `invokeWithProvider` 6 次。`uses saved tolerances rather than the defaults`：默认容差下 overlap 0.5→0.35 记退步，保存容差 0.2 后不记。闸门 `341 passed \| 4 skipped (345)` 文件，`3054 passed \| 18 skipped (3072)` 用例。 |
| B8.7 | ✅ | dc2e6da | `dataset.test.ts`：`covers both periods, a distant line, and day and night on the fixture` 通过（夹具切出的标答含 p1/p2、`distant`、day 与 night；同一输入两次 `toEqual`）。原有「留出句不出现在上下文里」「不超过四分之一」等断言全部通过。`metrics.test.ts`：`breaks the run down by period, and the bucket counts add up` 通过，`perPeriod` 键为 `p1`/`p2`，桶 `count` 之和等于 `cases`。`run.test.ts`：`samples the act against the held-out line's own state` 通过，`planTurn` 收到 `actCondition.emotion === "distant"`。临时库 `mirrai_v6_scratch` 0047 四步+升级路径：push 后 migrate 应用到 `0047_eval_cases_period`；`--replay` `replayed 45 migration(s)`；`--rollback 1` 后 `eval_cases` 无 `periodId`；再 migrate 回来；DROP 列并删 journal 后再 migrate，`periodId` 出现。库已 `dropdb`。闸门 `341 passed \| 4 skipped (345)` 文件，`3047 passed \| 18 skipped (3065)` 用例。层数多于名额时见偏差 72。 |
| B8.8 | ✅ | 26e83a6 (server); ef5bead (UI) | `service.test.ts`：开关开、`chatCount` 8 时 `invokeWithProvider` 2 次，事件有 `choice`（`好的呀`/`好的。`）、无 assistant 落库、无 `done`。通道 `wechat` 同开关只调用 1 次且落一句 assistant。`commitPendingChoice` / `fidelity.choose`：选中句落库、`createFidelityPair` 一行。`ab-pairs.test.ts`：30 行总选短句，`length` 权重为负。`db-delete-coverage` 通过。临时库 `mirrai_v6_scratch` 0049 四步+升级路径：push 后 migrate 到 `0049_fidelity_pairs`；`--replay` `replayed 47 migration(s)`；`--rollback 1` 后无 `fidelity_pairs`；再 migrate 回来；DROP 表并删 journal 后再 migrate，表出现。库已 `dropdb`。`ChoiceBubble.test.tsx`：标题「哪句更像 小A」，点「好的呀」调 `fidelity.choose`。`PersonaSwitches.test.tsx`：开关「偶尔让我二选一」，勾上走 `updateSettings` `patch.layers.abPairs: true`。闸门 `353 passed \| 4 skipped (357)` 文件，`3120 passed \| 18 skipped (3138)` 用例。`chatCount === 0` 与 `ll` 占位见偏差 75、76。 |
| B8.9 | ✅ | 600eca3 | `FidelityHistory.test.tsx`：三次运行曲线 3 个点；空状态含「怎么开始」；`isError` 显示重试并调用 `refetch`；两个人设版本对比区 2 列。`routers.blind.test.ts`：`lists the last three finished sittings and hides somebody else's` 通过，只返回 3 场且无 `groups`。闸门 `354 passed \| 4 skipped (358)` 文件，`3126 passed \| 18 skipped (3144)` 用例。 |
| B8.10 | ✅ | e80c4d0 (server); ec91af6 (UI) | 临时库 `mirrai_v6_scratch`：`material.test.ts` 3 通过：`theirs` 等于夹具 TA 行数 3332；`periods.ok`；前 30 行 `fingerprint` 不 ok，`need - have` = `MIN_FINGERPRINT_SAMPLES - 15`；别人的分身 `NOT_FOUND`。`material-report.test.ts`：每层 `need` 等于对应常量。`MaterialReport.test.tsx`：不够的层显示「还差 25」。闸门 `356 passed \| 5 skipped (361)` 文件，`3129 passed \| 21 skipped (3150)` 用例。固定回法一层等 B2.2。 |
| B9.1 | 🔒 |  |  |
| B9.2 | 🔒 |  |  |
| B9.3 | ⬜ |  |  |
| C1.1 | ✅ | 5723b34 (framework); format parsers 29196ef…e9e6811; 24a2233 (fflate); dd4e1bd (archive); e9797fc (PUT); 4ad0751 (routes) | 夹具 `server/test-fixtures/exports/<id>/` 每种已登记格式一份。`roundtrip.test.ts` 15 通过（imessage-db 不是文本格式，见偏差 31）。`detect.test.ts` 17 通过：每种样本认成自己且 ≥0.6，散文不被认领。`roles.test.ts`：fromMe 优先。`archive.test.ts` 5 通过：正常包解出 chat.txt+pic.jpg；`../evil.txt`/`/abs.txt` 跳过且不落在目录外；`maxEntries: 3` 时 `errorCode: "too-many-entries"` 且 dest 被删；`.md`/`.bin` 跳过。`import-upload-route.test.ts` 4 通过：未登录 401、别人的分身 404、超限 413、正常 PUT 后文件在 `personas/7/5/` 且 `createPersonaFile` `fileType: "chat_export"`。`routers-v6/import.test.ts`：preview 不调 `createCollectedMessages`/`updatePersonaFile`；`needs_roles` 且 me/them 空 → `BAD_REQUEST`；别人的文件 `NOT_FOUND`。`egress.test.ts` 4 通过。README 每种已登记格式有出处；`wechat-html` 在「Not listed」。闸门 `298 passed \| 3 skipped (301)` 文件，`2700 passed \| 13 skipped (2713)` 用例。 |
| C1.2 | ✅ | 267d8c6 (wizard); 50ab2ec (upload page) | `ImportWizard.test.tsx` 5 通过：detecting 有 progressbar 和「已处理 4 条」；needs_format 有格式下拉和「按列对应」；needs_roles 未同时选我/TA 时「继续」禁用，选 阿树=我、小满=TA 后 `import.confirm` 收到 `me:["阿树"]` `them:["小满"]`；done 文案含 added/theirs/existing；failed 显示原因和「再试一次」。`routers-v6/import.test.ts`：preview 不调 `createCollectedMessages`/`updatePersonaFile`；needs_roles 且 me/them 空 → `BAD_REQUEST`；别人的文件 `NOT_FOUND`。`Upload.test.tsx`：formatsHint 用服务端标签「一行一条」；`.zip` 走 PUT 不走 `file.upload`。实机（桩模型 `live-stub-model.mjs` 3122，应用 PORT 3133，临时库 `mirrai_v6_scratch`）：登录 c12user，分身「小满」，把 `server/test-fixtures/exports/wechat-txt-2line/sample.txt` 交给上传页 `input[type=file]` 的 change（与点击选择同一条 `handleFiles`）；向导 `needs_roles` 3 个说话人；指认 小满=TA、阿树=我、system=其他人；预览「微信 TXT（时间与昵称一行） · 共 13 条」「你 6 条，小满 6 条」；继续后「新增 13 条，其中 6 条是 小满 说的。0 条之前已经有了。」库 `collected_messages` 13 行（user 6 / assistant 6 / other 1），`persona_files.parseStatus=done` `format=wechat-txt-2line` `written=13`。库已 `dropdb`。闸门 `301 passed \| 3 skipped (304)` 文件，`2789 passed \| 13 skipped (2802)` 用例。 |
| C1.3 | ✅ | 25d6d1a (map/render); 14274b4 (readers) | `normalize.test.ts` 含上表每一行：`[图片]`/`[Photo]`/`<Media omitted>`/`<图片>` image，`[表情]`/`[动画表情]`/`[Sticker]`/`[表情:狗狗探头]` sticker，`[语音]`/`[语音 12秒]`/`[Voice]` voice，`[视频]`/`[Video]` video，`[位置]`/`[Location]` location，`[链接]`/`[文件]`/`[音乐]` link/file/music，`[转账]`/`微信转账`/`[红包]` transfer/redpacket，撤回/recalled recall，拍了拍 pat，通话 call；`[语音通话] 时长 00:43:12` → `durationSec: 2592`；「那张图片很好看」为 null。`wechat-csv.test.ts`：夹具表情 `kind: "sticker"` `content: "[sticker]"`，语音 `"[voice:12]"` `meta.durationSec: 12`，通话 `"[call:voice:2592]"` `meta.durationSec: 2592`。`shared/records.test.ts` 每种 kind 中英各至少一例（sticker `［表情：狗狗探头］` / `[sticker: 狗狗探头]`，call `［语音通话 43 分 12 秒］`）。`shared/copy/copy.test.ts` 通过。`dataset.test.ts`「does not train on sticker, voice, or call tokens」：小满夹具经 `trainingTexts` 后语料不含 `[sticker:`/`[voice:`/`[call:` 开头。闸门 `299 passed \| 3 skipped (302)` 文件，`2781 passed \| 13 skipped (2794)` 用例。 |
| C1.4 | ✅ | b80fc5f | `shared/scenes.test.ts`：夹具偶数 `sceneId` 标 `wechat_export`、奇数标 `sms` 后 `splitScenes` 切出的 id 序列与不标来源时相同。`db-store.test.ts`：同一秒同一句 `wechat_export` 与 `sms` 的 `idempotencyKey` 不同。临时库 `mirrai_v6_scratch` 上 `db-records.test.ts` 6 通过（原 5 条 + 新条）：两源各导入 3 条，`iterateRecords` 按时间交错 `wechat/sms/wechat/sms/wechat/sms`，12:04 的两句「嗯」都在。库已 `dropdb`。上传页列表等 C1.6。闸门 `303 passed \| 3 skipped (306)` 文件，`2798 passed \| 14 skipped (2812)` 用例；跳过 +1 见偏差 47。 |
| C1.5 | ✅ | d2858ff | 临时库 `mirrai_v6_scratch`（push + migrate 到 0045）上 `db-records.test.ts` 7 通过：`writes only the new tail when the same platform is imported again` 夹具 user/assistant 5202 条，先写 4161（80%），再导全量写入 1041（后 20%），第三次写入 0；第二次后 `styleProfile.recordsVersion` 变，第三次 `measuredAt` 仍是 `2026-02-01T00:00:00.000Z`。库已 `dropdb`。`style-profile.test.ts` 4 通过：recordsVersion 未变时 `setPersonaStyleProfile` 0 次；变了写 1 次；蒸馏过的分身 `pendingRedistillAdded: 4`；写入 0 不记。`StaleRecordsBanner.test.tsx`：added=0 不渲染；added=8 显示「新增了 8 条记录。分身还是按之前的记录建的。」点「把新的读进去」调用 onRebuild。闸门 `305 passed \| 3 skipped (308)` 文件，`2805 passed \| 15 skipped (2820)` 用例。 |
| C1.6 | ✅ | 0b53159 (server); d856d0e (UI) | `routers.file-delete.test.ts` 2 通过：别人的文件 `NOT_FOUND`；`storageDelete` 收到 `personas/1/5/chat.txt`。`routers-v6/record.test.ts` 3 通过：别人的分身 `NOT_FOUND`；sources 带上 `chat.txt` / `wechat-txt-2line`；`deleteSource` 调 `deleteRecordsBySource(5,1,"sms")`。临时库 `mirrai_v6_scratch` 上 `db-records.test.ts` 8 通过：`deleting one file leaves the other file's rows` 先写 3+2 条，删文件 A 后 `countRecords=2`。库已 `dropdb`。`RecordSources.test.tsx`：空列表不渲染；有来源时点删除出确认框，确认后 `file.delete({ fileId: 11 })`。`db-delete-coverage.test.ts`、`db-isolation.test.ts` 通过。闸门 `308 passed \| 3 skipped (311)` 文件，`2817 passed \| 16 skipped (2833)` 用例。 |
| C1.7 | ✅ | 825c73c | `redact.test.ts` 9 通过：`13800138000`→`[phone]`、`12345678901` 不动；`+8613800138000`→`[phone]`；18 位含末位 X→`[id]`、17 位不动；`alice@example.com`→`[email]`、`not@valid` 不动；`4111111111111111`→`[card]`、`1234567890123` 不动；`琪琪`/`我妈` 稳定为 `[person-1]`/`[person-2]` 且 other 的 speaker 也换；`keepNames: ["小满"]` 时分身名不动。`import.test.ts`：`confirm` 带 `redaction.phones` 时写库内容为 `打 [phone]` / `在的`，`parseReport.redaction` 为 `phones: true` `replaced.phones: 1`，两处 JSON 都不含 `13800138000`。`ImportWizard.test.tsx`：勾选「手机号」后预览「打 13800138000」变成「打 [phone]」。闸门 `309 passed \| 3 skipped (312)` 文件，`2828 passed \| 16 skipped (2844)` 用例。 |
| C1.8 | ⬜ |  |  |
| C2.1 | ⬜ |  |  |
| C2.2 | ⬜ |  |  |
| C2.3 | ⬜ |  |  |
| C2.4 | ⬜ |  |  |
| C2.5 | ⬜ |  |  |
| C2.6 | ⬜ |  |  |
| C2.7 | ⬜ |  |  |
| C2.8 | ⬜ |  |  |
| C2.9 | ⬜ |  |  |
| C2.10 | ⬜ |  |  |
| C3.1 | ⬜ |  |  |
| C3.2 | ⬜ |  |  |
| C3.3 | ⬜ |  |  |
| C3.4 | ⬜ |  |  |
| C3.5 | ⬜ |  |  |
| C3.6 | ⬜ |  |  |
| C3.7 | ⬜ |  |  |
| C4.1 | ⬜ |  |  |
| C4.2 | ⬜ |  |  |
| C4.3 | ⬜ |  |  |
| C4.4 | ⬜ |  |  |
| C4.5 | ⬜ |  |  |
| C4.6 | ⬜ |  |  |
| C5.1 | ⬜ |  |  |
| C5.2 | ⬜ |  |  |
| C5.3 | ⬜ |  |  |
| C5.4 | ⬜ |  |  |
| C5.5 | ⬜ |  |  |
| C6.1 | ⬜ |  |  |
| C6.2 | ⬜ |  |  |
| C6.3 | ⬜ |  |  |
| C6.4 | ⬜ |  |  |
| C6.5 | ⬜ |  |  |
| C6.6 | ⬜ |  |  |
| C7.1 | ⬜ |  |  |
| C7.2 | ⬜ |  |  |
| C7.3 | ⬜ |  |  |
| C7.4 | ⬜ |  |  |
| C8.1 | ⬜ |  |  |
| C8.2 | ⬜ |  |  |
| C8.3 | ⬜ |  |  |
| C8.4 | ⬜ |  |  |
| C8.5 | ⬜ |  |  |
| C8.6 | ⬜ |  |  |
| C8.7 | ⬜ |  |  |
| C8.8 | ⬜ |  |  |
| C8.9 | ⬜ |  |  |
| C8.10 | ⬜ |  |  |
| C8.11 | ⬜ |  |  |
| C8.12 | ⬜ |  |  |
| C8.13 | ⬜ |  |  |
| C8.14 | ⬜ |  |  |
| C9.1 | ⬜ |  |  |
| C9.2 | ⬜ |  |  |
| C9.3 | ⬜ |  |  |
| C9.4 | ⬜ |  |  |
| C9.5 | ⬜ |  |  |
| C9.6 | ⬜ |  |  |
| C9.7 | ⬜ |  |  |
| C9.8 | ⬜ |  |  |
| C10.1 | ✅ | 178f815 (detect); 4bde47e (filter/prompt); 092e6b8 (UI) | `shared/harm.test.ts`：四类词表各 ≥15；正例命中；「你这个小笨蛋」不命中；默认夹具 0 候选、`withHarm` 5 个 `belittle`；`pending`/`remove` 滤掉那 5 行、`keep` 不滤。`harm.test.ts` + `pipeline-harm.test.ts`：mock 确认全部 5 条后 `harmReport.categories` 有 `belittle`、`count: 5`、`decision: "pending"`。`pipeline-decisions.test.ts`：已选 `keep` 重跑仍是 `keep`。`persona-utils-harm.test.ts`：`pending` 时指令在底线之后、围栏之外；`keep` 与无报告不含该句。`prompt-golden.test.ts` 10 通过、快照未改。`HarmNotice.test.tsx`：默认选中「不学」；选「照实保留」调 `decideHarm({ id: 5, decision: "keep" })`；文案不含「家暴」「PUA」「有毒」。闸门 `330 passed \| 3 skipped (333)` 文件，`2957 passed \| 16 skipped (2973)` 用例。 |
| C10.2 | ⬜ |  |  |
| C10.3 | ⬜ |  |  |
| C10.4 | ⬜ |  |  |
| C10.5 | ⬜ |  |  |
| C10.6 | ⬜ |  |  |
| C10.7 | ⬜ |  |  |
| P18.1 | ⬜ |  |  |
| P18.2 | ⬜ |  |  |
| P18.3 | ⬜ |  |  |
| P18.4 | ⬜ |  |  |
| P18.5 | ⬜ |  |  |

## 偏差表

| # | 条目 | 这份文件写的 | 实际做的 | 为什么 |
|---|---|---|---|---|
| 1 | P0.1 | 写作基线是 `main` @ `4adc434`（v1.3.0） | 从当时的 `main` HEAD `f71e77b` 拉 `exec/v6` | `4adc434` 之后 `main` 上还有 AtomGit 徽章等文档提交；工作区只有两份未跟踪文档，符合 P0.1 做法第 1 步。闸门数字与第 2.2 节一致。 |
| 2 | P0.4 | 未单独点名 `getRecordsVersion` | `server/db.ts` 增加 `getRecordsVersion(personaId, userId)`，用 `count` + `max(id)` 生成 `${条数}:${最大id}` | 第 3.3 节要这个格式，P0.4 时还没有 `iterateRecords`；一次聚合查询避免把记录整表读进内存。 |
| 3 | P0.4 | `style.*` 可写在 `routers.ts` 或 `routers-v6` | `style` 组放在 `server/routers-v6/style.ts`，`appRouter` 只挂一行 | 第 3.7 节要求新增路由组不往 `routers.ts` 里堆逻辑。 |
| 4 | P0.5 | `kind: RecordKind` 引用 A1 的 `shared/records.ts` | `FixtureKind` 先在夹具里本地联合，取值与第 3.1 节闭集相同 | A1 还没建 `shared/records.ts`。 |
| 5 | P0.5 | `truth` 只列 sceneId/period/state/act/userAct/ritual/conflictEpisode | 另有 `slot`、`burstId`、`burstSize`、`burstIndex`、`locked` | 测试要按场景时段和连发分组；`locked` 防止抛光改掉设计句。被测代码仍不读 `truth`。 |
| 6 | P0.5 | `seedXiaoman(db, { userId })` | 签名保留 `db`，写入走 `createPersona` / `createCollectedMessages`（`getDb()`） | 现有 helper 都从模块取连接；A1 的记录表列还没有，先写入现有 `collected_messages`。 |
| 7 | P0.5 | 时间戳全部精确到秒 | `Date` 保留毫秒，`generic-line` 渲染到秒 | 连发间隔是「后一条字数 × 200 毫秒」，整秒会把短句的间隔抹掉。 |
| 8 | P0.5 | 晚间占七成、中午占两成 | 按每日主场景（evening/noon/afternoon）计，不含早场和周三加场 | 「每日一个场景」之外另有早场和周三下课场；若算进分母，晚间会远低于七成。 |
| 9 | P0.5 | 从不用「呢」 | 追一句「人呢」保留「呢」；其余 TA 文本不含「呢」 | 设计值表同一张里既写了从不用「呢」，又写了追一句 70% 是「人呢」。 |
| 10 | P0.6 | 把 `composeMessages` 里拼系统提示词和历史的部分搬进 `planTurn` | `composeMessages` 仍在 `service.ts`；聊天路径由 `planTurn` 动态 `import("./service")` 再调用它 | 静态互引会成环；评测走 `exclude` 分支自己拼 `history`，聊天仍从库读历史，行为与搬家前一致。 |
| 11 | P0.6 | `TurnPlan` / `executePlan` 的 io 只有手册 3.6 节列出的字段 | 另有 `recalled`、`rng`、`emptyAsSilence`、`trainingTexts`、`emitDeltas`；`TurnInput` 另有 `contextLimit` 等聊天字段 | 不改聊天落库、连发抽样和评测跳过空回答的行为。 |
| 12 | P0.6 | 抽动作用 `prompt.ts` 的 `actProfileForTurn` | `generate.ts` 里复写了同一段（先看时期 delta，再回落到 `personaData.actProfile`） | `server/eval/run.test.ts` 一行不改地 mock 了整个 `../chat/prompt`，只导出 `buildPromptForPersona`；具名导入 `actProfileForTurn` 会在访问时被 vitest 抛错。 |
| 13 | P0.6 | 第 3.6 节 `--compare <层>` | CLI 的 `--compare` 仍是原来的四路对比开关；新增的是 `--without a,b` | P0.6「做法」第 3 步只要求 `--without` 和旧 `--variant` 别名；`compare-cli.test.ts` 不许改。 |
| 14 | P0.7 | `server/` 下每一处 `fetch(` 都登记 | 扫描跳过 `*.test.ts` / `*.test.tsx` | 测试里的 `fetch` 打的是本机监听端口，或出现在夹具字符串里，不算出站。 |
| 15 | P0.7 | 文档「行数」和条目数一致 | 断言的是表体行数（`| id |` 且 id 含连字符）等于 `EGRESS_ITEMS.length`（14） | 文件还有标题和表头，整文件行数对不上条目数。 |
| 16 | P0.7 | 名人研究流程若发请求则登记 | `celebrity.ts` 只走已配置的 LLM provider，不自己 `fetch` | 写在 `docs/egress.md` 表前说明，不单列一行，避免把「没有出站」登记成出站。 |
| 17 | A1 | 新 db helper 一律写在 `server/db.ts` | `importRecords` 写在 `server/collectors/db-store.ts`，紧挨 `importCollectedMessages` | 手册 A1 做法 4 允许「在它旁边新增」；上传测试要 mock `createCollectedMessages`，同一模块内的调用 mock 不到。 |
| 18 | A1 | `iterateRecords` 用 JS `Date` 做 keyset 游标 | 游标是 `(spokenAt, id) > (SELECT … WHERE id = $cursorId)` | `timestamp without time zone` 和 JS `Date` 比较会对不上，分页少行、`getRecordsAround` 的 after 为空。 |
| 19 | A1 | `countRecords` / `iterateRecords` 的 `userId` 过滤只在 `recordsWhere` 里 | 函数体再写一次 `eq(collectedMessages.userId, userId)`；`getRecordsAround` 的返回类型做成具名 `RecordsAround` | `db-isolation` 要求 helper 函数体出现 `eq(.userId)`；返回类型里的 `{` 会被扫描器当成函数体开头。 |
| 20 | A1 | 闸门跳过数不能增加 | 无 `DATABASE_URL` 时 `db-records.test.ts` 5 条 `skipIf`，跳过文件 3、跳过用例 13（原 2 文件 / 8 用例） | 手册 2.3 要求新的库测试用 `skipIf(!DATABASE_URL)`。带临时库跑这 5 条全过。 |
| 21 | A1 | 现状写 `service.ts` 重排分支、`eval/run.ts` 读记录 | 重排在 `generate.ts`；`eval/run.ts` 不再自己读记录，评测 CLI 在 `scripts/eval-run.ts` | P0.6 把生成路径收拢之后的代码。 |
| 22 | A1 | `startImport` 是 C1.1 的框架 | A1 建了瘦的 `server/importers/`（`types`/`roles`/`generic-line`/`startImport`），`file.upload` 接上它 | A1 做法 5 要求上传后调用 `startImport`，C1.1 再补检测、其余格式、归档和向导路由。 |
| 23 | A1 | 写入前 `countRecords` 加本批不超过上限 | 上限用 `countRecords(..., { register: "all" })` | 默认 `register` 是 private，上限必须算整张表。 |
| 24 | A1 | `file_type` 的 `chat_export` 对齐 C1.1 白名单（含 html/xml/db/mht） | A1 只允许 `.txt` `.csv` `.json`；`.zip` 走 `archive` | html 会在同源上传目录当页面跑；其余扩展等 C1.1 格式落地再开。 |
| 25 | A1 | 对 `archive` 调用 `startImport` 并解析 | `archive` 停在 `needs_format`，不把 zip 当文本解析 | 解包是 C1.1。 |
| 26 | A1 | `generic-line` 沿用 `parseTranscriptMessages`：没有说话人时每行算一条 | 没有说话人的文件全部跳过，记入 `skipped` | 导入需要说话人才能猜角色；表头和说明行不许进记录表。 |
| 27 | A1 | 先红后绿：旧代码上 `exemplarSectionFor` 断言「有示范」为红 | `exemplars-upload.test.ts` 在写入路径落地之后才写成；空记录仍无示范段，导入后有 | 本会话从 4–5 步接着做，没有回到 4–5 之前的 HEAD 跑那条红。 |
| 28 | C1.1 | `wechat-html` 列为已支持 | 不进注册表，README「Not listed」 | 2026-11-16 核对于 WeChatMsg HTML 导出：消息是注入查看器的 JS 对象，没有稳定静态表。手册：联网查不到的格式不要列为已支持。 |
| 29 | C1.1 | 文本 `detect` 低于 0.3 返回 null；取前 300 行消息头占比 | 两行一块的格式用 `blockHeaderRatio`（分母不含消息体行），阈值仍是 0.3 / 0.6 / 0.15 | 按行计数会把两行格式的置信度封在 ~0.5，夹具过不了「≥ 0.6」。 |
| 30 | C1.1 | LINE / Kakao 往返时间精确到该格式能表达的粒度 | `roundtrip.test.ts` 对这两种放宽到 `time: "minute"` | 导出只有 `HH:mm`，没有秒。 |
| 31 | C1.1 | 每种文本类格式走 `renderFixture` 往返 | `imessage-db` 走 `formats/imessage-db.test.ts`，不进 `roundtrip.test.ts` | chat.db 是 SQLite，不是文本。 |
| 32 | C1.1 | zip 条目是符号链接则跳过 | `fflate` 的 `UnzipFile` 不暴露 unix mode / extra；解出的是普通文件（内容是链接目标），从不 `symlink()` | 流式 API 看不到符号链接位。`..` 和绝对路径仍跳过。 |
| 33 | C1.1 | PUT 扩展名 = 解包白名单（聊天+媒体）或 zip | PUT 只接受聊天扩展名和 `.zip`；媒体只从 zip 里解出 | `file_type` 枚举没有 `audio`；单独传一张图不应走导入器。 |
| 34 | C1.1 | `MAX_IMPORT_BYTES` 默认 2 GiB | 实际上限 `2147483647`（2 GiB − 1） | `persona_files.fileSize` 是 signed int4，存不下 2147483648。 |
| 35 | C1.1 | 验收点名 `server/routers.import.test.ts` | 测试在 `server/routers-v6/import.test.ts`（路由组按 3.7 节放 `routers-v6`） | 与 A1 的 `import.backfill` 同一文件。 |
| 36 | A1/C1.1 | 偏差 24：`chat_export` 只允许 txt/csv/json | C1.1 起 `ALLOWED_EXTENSIONS.chat_export` 为 txt/csv/json/html/htm/xml/db/mht；zip 仍走 `archive` | 格式已落地。html 仍只给属主看（`uploadsAuthGuard`）。 |
| 37 | C1.3 | 文本占位规则只列在 generic-line / wechat-txt / qq-txt | LINE `[写真]`/`[スタンプ]`/`☎ 通話時間`、Kakao `사진`/`동영상`/`이모티콘`、iMessage `is_audio_message` / attachment MIME 也映射了 | 2026-11-16 对照 LINE 导出样本、Kakao 导出说明、macOS chat.db 文档；不映射会把整段占位当语气。 |
| 38 | C1.3 | 验收点名把夹具喂给 `buildCharNgramModel` 的语料构造处 | 过滤写在 `trainingTexts`（以及 `generate.ts` 里同一段后备语料）；测试先 `trainingTexts` 再 `buildCharNgramModel` | 手册列的就是这处语料，不是 `buildCharNgramModel` 本身。 |
| 39 | C1.3 | 微信两行 TXT 的无昵称系统行保持 `kind: system` | `你撤回了一条消息` 现为 `kind: recall`、`content: "[recall]"` | 与占位规则「含撤回了一条消息 → recall」一致；`wechat-txt-2line.test.ts` 跟着改。 |
| 40 | C1.2/A3 | 先红后绿：旧代码上 csv 无角色 | `csv-not-unlabelled.test.ts` 在 C1.1 已给 wechat-csv 角色之后写成；现码上是绿的 | 不能倒回 C1.1 之前的 HEAD。与偏差 27 同类。 |
| 41 | C1.2 | 格式未定时向导再调 `startImport` | 路由名是 `import.resume`，不是 `apply` | tRPC `router({})` 把 `apply` 当保留字。 |
| 42 | C1.2 | `confirm` 只负责带角色的写入 | `confirm` 在任何状态下都要求 me/them；选格式、选会话、失败重试走 `resume` | 已有 `confirm` 的 BAD_REQUEST 验收不能放宽。 |
| 43 | C1.2 | 实机「拖入」夹具 | 自动化浏览器里 Vite 开发页 `#root` 不挂载（`plugin-react` preamble）；改用 `NODE_ENV=production` 的 `dist/`。文件通过 `DataTransfer` 赋给隐藏 `input[type=file]` 再 `change`，与点击选择同一条 `handleFiles`，不是操作系统拖放。 | 玻璃浏览器跑不了 Vite HMR；CDP `setFileInputFiles` 不可用。 |
| 44 | C1.2 | `isUnparsedChatUpload` 只认 chat_txt/chat_csv | 现含 `chat_export` 和 `archive`；`isChatImportFileType` 收到 `shared/records.ts` | 向导挂在所有聊天上传上；旧的 json/zip 也该能补导入。 |
| 45 | C1.2 | 时区入口跳到「设置里的时区」 | 资料页原先没有用户时区编辑，补了 `settings.profile.timezone` 字段 | `user.updateProfile` 本来就收 timezone；TimezoneSync 只在空值时写入。 |
| 46 | A4/A2 | `periods.length === 2`，边界落在 2023-07-05 | 独立验收时切出 12 段、边界在 2023-07-12。`c46b0d7` 改回：除那段静默外活跃日间隔不超过 13 天，静默后第一天是 2023-07-05；`findPeriodSplits` 按说话时间排序。测试断言正好两段，边界在 2023-07-05 | 按数组顺序切会把后补的早场当成另一段静默。 |
| 47 | C1.4 | 闸门跳过数不能增加 | 无 `DATABASE_URL` 时 `db-records.test.ts` 现 6 条 `skipIf`（原 5），跳过用例 14 | 手册 2.3 要求库测试 `skipIf(!DATABASE_URL)`。带临时库跑这 6 条全过。与偏差 20 同类。 |
| 48 | C1.5 | 蒸馏过的分身靠 `styleProfile.recordsVersion` 判断要不要提示重建 | `personas.settings.pendingRedistillAdded` 累加新写入条数；上传页读它 | 导入完成后立刻 `measureStyleProfile`，`recordsVersion` 会跟上新条数，分身是不是按旧记录建的从画像上看不出来。C1.6 的「记录少了」仍按手册去对 `countRecords` 与 `recordsVersion`。 |
| 49 | C1.5 | 闸门跳过数不能增加 | 无 `DATABASE_URL` 时 `db-records.test.ts` 现 7 条 `skipIf`（原 6），跳过用例 15 | 新增的 80%/20% 增量测试同样 `skipIf`。带临时库跑这 7 条全过。与偏差 20、47 同类。 |
| 50 | C1.5 | `setPersonaStyleProfile` 无库时抛 `DB not available` | 无库时返回 `false` | 导入在测量失败时仍应结束；测试 mock 没有库，抛错会打 warn。与 `getPersonaStyleProfile` 无库返回 `null` 对齐。 |
| 51 | C1.6 | 闸门跳过数不能增加 | 无 `DATABASE_URL` 时 `db-records.test.ts` 现 8 条 `skipIf`（原 7），跳过用例 16 | 两个文件删一个的库测试同样 `skipIf`。带临时库跑这 8 条全过。与偏差 20、47、49 同类。 |
| 52 | C1.6 | `deletePersonaFile` 返回匿名对象类型 | 具名 `DeletedPersonaFile` | `db-isolation` 的函数体扫描把 `Promise<{` 当成函数体开头（与偏差 19 同类）。 |
| 53 | C1.7 | `server/importers/redact.ts` 放实现 | 实现在 `shared/redact.ts`，`server/importers/redact.ts` 再导出 | 向导预览在客户端实时替换，必须和写库用同一份函数。 |
| 54 | C1.3 | 微信 CSV 只有 IsSender、StrContent、StrTime、Type、SubType、NickName | 往返渲染多了 StickerKey、Transcript、Direction、Mode。解析器只在这些列存在时读进 meta | 夹具的表情键、转写和通话方向不在原表里。没有这些列的文件仍按原样解析。 |
| 55 | C1.2 | A1 里上传后 `startImport` 在角色猜得出时就写入 | `cf3214d`：猜得出也停在 `needs_roles`，猜测放进 `parseReport.suggested` 供向导预填。只有 `confirm` 带齐两边才写。同一文件再次确认先删掉它自己的行再写 | 预览和确认之前不能入库。脱敏会改内容，旧的去重键会把原文留下。 |
| 56 | C1.1 | 日月都看不出时两种顺序都对 | 短日期默认按月日，也就是手册里的 Android `M/D/YY`。文件里有大于 12 的日或月时，整份按那个证据 | 没有证据时必须选一边。原先默认日月，把 `3/1/22` 读成 1 月 3 日。 |
| 57 | A6 | 验收写卡片显示「上次联系 3 天」 | 复用已有 `chat.lastContact`，渲染成「上次联系 3 天前」 | 做法明确写复用聊天页同一条文案；验收那句是做法里的中性说法。 |
| 58 | A7 | `letters` 最早一行 | `getUserMilestones` 只取 `kind = "letter"` 的最早 `createdAt` | 同表里还有「等 TA 回来再说」的 todo；`countLetters` 已经排除它们。「写下了第一封信」不该点亮在一条待办上。 |
| 59 | A9 | `source` 指向运营方自己的官方页面 | `cn-national` 的 `source` 是疾控局新闻发布会页，不是卫健委设号通知原文 | nhc.gov.cn 这条通知本机 HTTP 412；疾控局页面（curl 200）写明全国 31 省已开通 12356。设号通知的全文是检索结果里拿到的，不当作本机打开的来源。 |
| 60 | A8 | 「重建出来的」写在 `prompts.memoryExtraction` 里 | 这句单独放在 `prompts.memoryExtractionInApp`，只在应用内抽取时接在共用提示词后面 | 上传记录两边都是真的。共用提示词仍要求 `line`。 |
| 61 | B1.1 | `approxCalls` 从固定数字改成由预估给出 | 未选中的预设仍显示写死的 `approxCalls`；选中项和上传页段落用 `skillEngine.estimate` | 预估要按模式切块，一次查询只算当前模式。未选中的仍用旧数字当量级。 |
| 62 | B1.1 | 时期标「现在」的过去段文案未规定用字 | `distill.periodPast` zh 是 `{{from}} 至 {{to}}` | `copy.test.ts` 要求中文半边有汉字；用「–」会红。 |
| 63 | B1.1 | 所有块的行数之和等于文本行数 | 之和等于 `user`/`assistant` 说话行（含非文本 kind） | 块里也装渲染后的非文本行；`kind === "text"` 会比装进去的少。 |
| 64 | B1.1 | 现有 `pipeline.test.ts` 不改就通过 | mock 工厂补了 `iterateRecords` / `createDistillationChunk` / `createDistillationCard` 三行 | vitest 读未导出的 mock 会抛；行为断言没改。 |
| 65 | B1.3 | 预估含全部蒸馏调用 | `estimateDistillation` 仍只计观察卡的 map/reduce 和旧的 `approxCalls` | 手册 B1.3 没要求改预估；事实卡是额外调用。 |
| 66 | B1.4 | 取样只写 fast 80 / standard 1500 / deep 全部 | `colleague` 按 1500，`celebrity` 按全部 | 手册没给这两种预设的标注预算；分别靠上 standard 和 deep。 |
| 67 | B1.5 | 情绪取样只写 fast 不调 / standard 600 / deep 全部 | `colleague` 按 600，`celebrity` 按全部 | 与偏差 66 同一理由。 |
| 68 | B1.6 | 跳过记在 `personaData.clarified`，不再问 | 卡片上点「跳过」只在本会话隐藏该题，不调 `answerClarification` | 验收写「跳过不调用写入」；做法第 2 步写跳过也记入 `clarified`。按验收。刷新页面还会再问。路由仍接受 `skip: true` 供以后持久化。 |
| 69 | B1.9 | 闸门跳过数不能增加 | 无 `DATABASE_URL` 时 `db-persona-versions.test.ts` 2 条 `skipIf`，跳过文件 4、跳过用例 18 | 手册 2.3 要求库测试 `skipIf(!DATABASE_URL)`。带临时库跑这 2 条全过。与偏差 20、47、49、51 同类。 |
| 70 | B3.1 | 夹具 `particles["呢"] === 0` | 约为 0.0067，全部来自追一句「人呢」 | P0.5 偏差 9：设计表既写了从不用「呢」，又写了追一句 70% 是「人呢」。`lastParticleOf` 按手册剥完标点后看最后一个字。 |
| 71 | B3.1 | `laugh.haRuns` 只有长度 4 那一格非零 | 长度 4 是绝大多数（124）；另有少量 2（2）和 3（9） | 夹具把「呵呵」换成「哈哈」，以及 `fitLength` 在句末前插入衬字，会把「哈哈哈哈」拆开。不改夹具。 |
| 72 | B8.7 | 每个非空的层至少 1 条 | 层数多于名额时，改回在全部候选上等距取 | 两句对话只留 1 条时无法每层一条；否则会丢掉「我也想你」那条原有测试。名额够覆盖每一层时仍按层分配。 |
| 73 | B8.1 | 前三个特征里有「以句号结尾」 | 报告里的 `feature` 是 `ending.period`；界面再译成「以句号结尾」 | 生产代码不能写没对照的中文。单字「。」的 n-gram 并进同一个特征，避免句号独热和哈希抢权重。 |
| 74 | B8.4 | 只写 `eval.audition({ personaId })` | 另加只读 `eval.auditionInfo`，返回模型数、标答数和预估调用数 | 按钮旁要在开跑前写出「一共约 N 次调用」；mutation 本身会调模型，不能拿它当预览。 |
| 75 | B8.8 | `chatCount % 8 === 0` 含 0 | `shouldOfferChoice` 要求 `chatCount > 0` | 第 0 轮还没有往来，不必付两倍费用。待选的两句存在用户消息 `metadata.pendingChoice`。 |
| 76 | B8.8 | 特征含 B3.3 的 `ll` | 现码 `ll` 恒为 0 | B3.3 未做，没有 token log-likelihood。长度、surprise、residue、act、real 已按现有函数填。 |
| 77 | B8.10 | 闸门跳过数不能增加 | 无 `DATABASE_URL` 时 `material.test.ts` 3 条 `skipIf`，跳过文件 5、跳过用例 21 | 手册 2.3 要求库测试 `skipIf(!DATABASE_URL)`。带临时库跑这 3 条全过。与偏差 20、47、49、51、69 同类。路由测试不走 `appRouter`，避免 `node:sqlite`。固定回法一层未列入 `layers`，等 B2.2。 |

## 未验证清单

| 条目 | 缺什么 | 该跑的命令 | 谁来跑 |
|---|---|---|---|
| C1.1 | `wechat-html` 没有稳定静态 schema，未实现 | 若之后有静态 HTML 样本：对照样本写 `formats/wechat-html.ts`，再进注册表 | 有真实 WeChat HTML 导出的人 |

## 待用户决定

| 条目 | 问题 | 两个选项各自的后果 |
|---|---|---|
| A7 | 亲密度 `computeIntimacy` 里含连续对话天数（`consecutiveDays * 10`，最高 100 分），是否拿掉 | 拿掉：毕业门槛少这一项输入，已有分身的亲密度分数会下降，可能改变毕业建议。留着：大厅已经没有打卡，分数里仍奖励连续聊。手册 A7 边界写明这一条不动它，等决定。 |

## 批次日志

### WP0 · 实现会话 · 2026-11-16

- 分支 `exec/v6` 已从 `main` (`f71e77b`) 拉出。`core.hooksPath` 已是 `.githooks`（又执行了一次 `git config core.hooksPath .githooks`）。
- P0.1 文档提交：`b3710ef`（仅 `docs/ideas-v6.md`、`docs/exec-v6.md`）；进度文件：`2fe5653`。
- 基线已跑，数字与手册 2.2 一致（见上表）。临时库 `mirrai_v6_scratch` 已删除。
- P0.2：`b298550`（`scripts/gate-all.mjs`、`server/gate-script.test.ts`、`package.json` 的 `gate` 脚本）。闸门测试 260 文件 / 2497 用例（+1 文件、+3 用例）。
- P0.3：`e506484`（`server/chat/prompt-golden.test.ts` 与快照）。闸门 261 文件 / 2507 用例（+1 文件、+10 用例）。
- P0.4：`1e44f5d` 数据层，`e59ec6d` 路由和界面。闸门 266 文件 / 2522 用例。`--replay` 现为 42 条（含 0044）。
- P0.5：`b1fe349`（`server/test-fixtures/xiaoman.ts`、`xiaoman.test.ts`、`render.ts`、`seed-db.ts`）。闸门 267 文件 / 2557 用例（+1 文件、+35 用例）。
- P0.6：`1588608` 搬家（`server/chat/generate.ts`、`service.ts`、`shared/layers.ts`）；`b089be8` 评测接入（`server/eval/run.ts`、`scripts/eval-run.ts`、`generate.test.ts`）。闸门 269 文件 / 2565 用例。
- P0.7：`16ad889`（`shared/egress.ts`、`docs/egress.md`、`server/egress.test.ts`、`EgressList`、设置页挂载）。闸门 271 文件 / 2570 用例（相对 P0.5：+4 文件、+13 用例；相对本会话开工时的 P0.5 闸门 267/2557）。
- WP0 可做条目全部完成。独立验收另开会话。未验证清单、待用户决定仍空。

### WP0 · 独立验收 · 2026-11-16

对照 `docs/exec-v6.md` 的 P0.1–P0.7 重跑。`corepack pnpm gate` 退出码 0：`Test Files  269 passed | 2 skipped (271)`，`Tests  2562 passed | 8 skipped (2570)`，与本文件 P0.7 一行一致；通过数高于基线 2486，跳过数仍是 8。临时库 `mirrai_v6_verify` 上 0044 的 push / migrate / `--replay` / `--rollback 1` / 再 migrate / 升级路径（删列并删 `schema_migrations` 后再 migrate）都通过，库已 `dropdb`。`mirrai_live` 未碰。黄金快照只在 `e506484` 出现过。`main..HEAD` 没有删改已有测试、没有 `Co-Authored-By`、没有新的 npm 依赖、没有改 `server/wechat/ilink` 或旧迁移。

P0.1、P0.2、P0.3、P0.4、P0.6、P0.7 维持 ✅。P0.5 改回 ⬜。

- [x] P0.5 追一句：`c785e6a`。追一句改到 `retargetMedian` 和最后一次 `fixBurstGaps` 之后插入，并平移该场景里更晚的消息。测试断言每条距上一条 TA 在 6–12 分钟，且中间没有用户消息。
- [x] P0.5 早晚的往来：`c785e6a`。股票、生日、咖啡馆、未结的事、伤人的话改为改写已有行，不再在晚安之后追加。测试断言每个晚间场景的最后两行是「晚安」往来，并且收在同一天。
- [x] P0.5 规模：`c785e6a`。`roundsPerMainScene` 改为 10。非冲突的中午和下午场景用户行数是 10，晚间是 11（含晚安）。
- [x] P0.5 回复间隔：`c785e6a`。去掉 8–90 秒 / 8–400 秒的预截断，只在晚间跨过午夜时收到 23:59:50。测试断言晚间和白天的对数标准差与 0.8 相差小于 0.08。
- [x] P0.5 表情包：`c785e6a`。测试按 `burstId` 断言 happy/playful 25%、melancholy 30%，容差 ±5 个百分点。
- [x] P0.6 `--without act`：`58d1123`。测试分身带 `samples: 80`、`unconditional: { tease: 80 }`。不覆盖时 `sampledAct` 为 `tease`，`--without act` 时为 null，且 `layersUsed` 不含 `act`。
- [x] P0.6 留出句：`58d1123`。采集记录里放进这句留出的话。聊天提示词含它，评测提示词不含它；拿掉聊天侧那一整段示范之后，两边消息 `toEqual`。
- [x] P0.7：`e6e22c1`。未登记用例把 `server/invented-egress.ts` 里的 `fetch("https://example.com")` 放进同一次扫描，断言缺的就是这个文件。扫描函数与磁盘上的白名单检查是同一个。

### WP0 · 实现会话 · 2026-11-16 · 验收问题

- `c785e6a` 修 P0.5。`58d1123` 修 P0.6 的两条测试。`e6e22c1` 修 P0.7 的扫描测试。
- 修完后 `corepack pnpm gate` 退出码 0：`269 passed | 2 skipped (271)` 个文件，`2562 passed | 8 skipped (2570)` 个用例。通过数没有减少，跳过数没有增加。

### WP0 · 独立验收 · 2026-11-16 · 修复后复验

对照当前 `exec/v6` HEAD 重跑，不沿用上一轮验收写在表里的证据。`corepack pnpm gate` 退出码 0：`Test Files  269 passed | 2 skipped (271)`，`Tests  2562 passed | 8 skipped (2570)`。通过数高于基线 2486，跳过数仍是 8。临时库 `mirrai_v6_verify` 上 0044 的 push、migrate、`--replay`（42 条）、`--rollback 1`（两列消失）、再 migrate（两列回来）、升级路径（手动删列并删 `schema_migrations` 的 0044 后再 migrate，两列出现）都通过，库已 `dropdb`。`mirrai_live` 未碰。故意的类型错误让闸门在 typecheck 以退出码 2 停下（`[gate] failed at typecheck`）。改 `prompt.identityVolunteers` 的中文「【AI 身份】」一个字，8 个黄金快照变红，还原后 10 通过。在 `server/llm/index.ts` 加一处 `fetch("https://example.com")`，扫描报缺的就是这个文件，还原后 4 通过。快照文件只在 `e506484` 出现过。`main..HEAD` 没有改已有测试、没有 `Co-Authored-By`、没有新的 npm 依赖、没有改 `server/wechat/ilink` 或旧迁移。

P0.1、P0.2、P0.3、P0.4、P0.6、P0.7 维持 ✅。P0.5 改回 ⬜。

- [x] P0.5 冲突被周三的下课场打断。`34f5564`。冲突只排在非周三的午场；每个活跃周三的下课场仍在 16:05 之后。测试断言「就嗯？」到和好之间没有别的消息。
- [x] P0.5 冲突时长不是设计的 3、4、5、5、6、8 小时。`34f5564`。和好时刻改为「就嗯？」的时间加上设计小时数。测试断言这六个时长。

### WP0 · 实现会话 · 2026-11-16 · 冲突时长

- `34f5564` 修上面两处。冲突不落在周三，和好从「就嗯？」起算满设计的小时数，这段保持空白。追一句不再平移冲突场景里的消息，改错字不会插进晚安或这段空白。多点回复的八成按实际写上的回复来分，不按没对上的用户行来分。
- 修完后 `corepack pnpm gate` 退出码 0：`269 passed | 2 skipped (271)` 个文件，`2562 passed | 8 skipped (2570)` 个用例。通过数没有减少，跳过数没有增加。P0.5 改回 ✅。

### WP1 · 实现会话 · 2026-11-16 · A1

- 分支 `exec/v6`。独立验收留下的 `- [ ]` 已全部勾掉。没有「等 xxx」的推后项。
- A1 按手册拆成四个提交：`6cf669d` 表/共用模块/db helper；`c017aed` `importRecords` + `generic-line` + 上传触发；`6736dc3` 读者 `{ newest: true }`；`3d66751` `import.backfill` 和上传页横幅。
- 临时库 `mirrai_v6_scratch` 上跑过 db-records（5/5），用完已删。`mirrai_live` 未碰。
- 无 `DATABASE_URL` 的 `corepack pnpm gate`：`278 passed | 3 skipped (281)` 文件，`2604 passed | 13 skipped (2617)` 用例，`all six steps passed`。相对 WP0 闸门（269/2 文件、2562/8 用例）：通过文件 +9、通过用例 +42；跳过文件 +1、跳过用例 +5，全部来自 `db-records.test.ts` 的 `skipIf`（见偏差 20）。
- A1 标 ✅。C1.1 起未做。未验证清单、待用户决定仍空。

### WP1 · 实现会话 · 2026-11-16 · C1.3

- 分支 `exec/v6`。C1.1 已 ✅。无独立验收遗留项。
- C1.3 两个提交：`25d6d1a` 映射与渲染（含 `parseTextPlaceholder`、各格式映射表、`renderRecordContent`、归档 `meta.path`）；`14274b4` 文本统计读者只读 `kind === "text"`。
- 验收命令（无 `DATABASE_URL`）：`vitest run server/importers/normalize.test.ts shared/records.test.ts shared/copy/copy.test.ts server/importers/formats/wechat-csv.test.ts server/eval/dataset.test.ts` 全过。闸门 `299 passed | 3 skipped (302)` 文件，`2781 passed | 13 skipped (2794)` 用例，`all six steps passed`。相对 C1.1 闸门（298/3 文件、2700/13 用例）：通过文件 +1、通过用例 +81；跳过数不变。
- `mirrai_live` 未碰。本条无临时库。
- C1.3 标 ✅。C1.2 起未做。

### WP1 · 实现会话 · 2026-11-16 · C1.1

- 分支 `exec/v6`。独立验收留下的 `- [ ]` 已全部勾掉。没有「等 xxx」的推后项。
- C1.1 按手册拆分：框架 `5723b34`；每种已核对格式一个提交（`29196ef`…`e9e6811`）；白名单依赖 `24a2233`（`fflate` 0.8.3 MIT）；归档包 `dd4e1bd`；流式上传 `e9797fc`；路由 `4ad0751`。`wechat-html` 未列入。
- 验收命令（无 `DATABASE_URL`）：`vitest run server/importers/roundtrip.test.ts detect.test.ts roles.test.ts archive.test.ts server/import-upload-route.test.ts server/routers-v6/import.test.ts server/egress.test.ts` → 7 文件 59 通过。闸门 `298 passed | 3 skipped (301)` 文件，`2700 passed | 13 skipped (2713)` 用例，`all six steps passed`。相对 A1 闸门（278/3 文件、2604/13 用例）：通过文件 +20、通过用例 +96；跳过数不变。
- `mirrai_live` 未碰。本条无临时库。
- C1.1 标 ✅。C1.3 起未做。未验证清单新增 wechat-html。待用户决定仍空。

### WP1 · 实现会话 · 2026-11-16 · C1.2 / A3

- 分支 `exec/v6`。无独立验收遗留项。
- C1.2 两个提交：`267d8c6` 向导组件（含 `import.resume`、`rawTable`/`existing`、A3 `csv-not-unlabelled.test.ts`）；`50ab2ec` 上传页接入（流式 PUT、`ALL_ACCEPT`、formatsHint、设置里的时区）。
- 验收命令（无 `DATABASE_URL`）：`vitest run client/src/components/v6/ImportWizard.test.tsx server/importers/csv-not-unlabelled.test.ts server/routers-v6/import.test.ts client/src/pages/Upload.test.tsx` 全过。闸门 `301 passed | 3 skipped (304)` 文件，`2789 passed | 13 skipped (2802)` 用例，`all six steps passed`。相对 C1.3 闸门（299/3 文件、2781/13 用例）：通过文件 +2、通过用例 +8；跳过数不变。
- 实机：临时库 `mirrai_v6_scratch`（push + migrate 到 0045），桩模型 3122，应用 3133。夹具 wechat-txt-2line → 预览 13 条 → 指认角色 → 库 13 行。库已删。`mirrai_live` 未碰。
- C1.2、A3 标 ✅。A4 起未做。未验证清单无新增。待用户决定仍空。

### WP1 · 实现会话 · 2026-11-16 · A4 / A2

- 分支 `exec/v6`。无独立验收遗留项。
- A2 一个提交：`042d0bf`（`toMinerRows`、`mineOpenLoops` 只认 user/assistant、`minePeriods` 传入 locale、文本路径 seam 测试）。A4 一个提交：`507c44c`（`PipelineInput.records`、`startPersonaDistillation` 有记录时走结构化行和带时间的文本、`toTimedTranscript`）。
- 先红后绿（亲自跑过）：在改映射之前 `vitest run server/skill-engine/pipeline-v5-seam.test.ts` 红，`actProfile` 为 `null`（`expected null to be truthy`）。
- 验收命令（无 `DATABASE_URL`）：`vitest run server/skill-engine/pipeline-v5-seam.test.ts server/skill-engine/roles.test.ts server/skill-engine` 与 `server/chat/prompt-golden.test.ts` 全过。闸门 `303 passed | 3 skipped (306)` 文件，`2796 passed | 13 skipped (2809)` 用例，`all six steps passed`。相对 C1.2 闸门（301/3 文件、2789/13 用例）：通过文件 +2、通过用例 +7；跳过数不变。
- `mirrai_live` 未碰。本条无临时库。
- A2、A4 标 ✅。C1.4 起未做。未验证清单无新增。待用户决定仍空。

### WP1 · 实现会话 · 2026-11-16 · C1.4

- 分支 `exec/v6`。无独立验收遗留项。
- C1.4 一个提交：`b80fc5f`。`splitScenes` 与去重键本来就不看来源/按平台分键；本条补验收。上传页来源列表留给 C1.6。
- 临时库 `mirrai_v6_scratch`（push + migrate 到 0045）上 `db-records.test.ts` 6 通过，库已删。`mirrai_live` 未碰。
- 闸门 `303 passed | 3 skipped (306)` 文件，`2798 passed | 14 skipped (2812)` 用例，`all six steps passed`。相对 A4 闸门（303/3 文件、2796/13 用例）：通过用例 +2；跳过用例 +1（偏差 47）。
- C1.4 标 ✅。C1.5 起未做。未验证清单无新增。待用户决定仍空。

### WP1 · 实现会话 · 2026-11-16 · C1.5

- 分支 `exec/v6`。无独立验收遗留项。
- C1.5 一个提交：`d2858ff`。同一平台再导入靠已有去重键只进新行；`startImport` 成功后 `afterRecordsChanged`（`recordsVersion` 变了才重量）；已蒸馏分身把新增条数记进 `pendingRedistillAdded`；横幅「把新的读进去」走完整蒸馏（B1.7 未落地）；蒸馏开始时清掉该计数。
- 临时库 `mirrai_v6_scratch`（push + migrate 到 0045）上 `db-records.test.ts` 7 通过（5202 条 80%→4161，再导全量写入 1041，第三次 0；第二次 recordsVersion 变，第三次 `measuredAt` 不变）。库已删。`mirrai_live` 未碰。
- 闸门 `305 passed | 3 skipped (308)` 文件，`2805 passed | 15 skipped (2820)` 用例，`all six steps passed`。相对 C1.4 闸门（303/3 文件、2798/14 用例）：通过文件 +2、通过用例 +7；跳过用例 +1（偏差 49）。
- C1.5 标 ✅。C1.6 起未做。未验证清单无新增。待用户决定仍空。

### WP1 · 实现会话 · 2026-11-16 · C1.6

- 分支 `exec/v6`。无独立验收遗留项。C1.4 的上传页来源列表一并补上。
- C1.6 两个提交：`0b53159` 服务端（`file.delete`、`record.sources` / `record.deleteSource`、`deletePersonaFile` 事务、磁盘在提交后删、`pendingRedistillRemoved`）；`d856d0e` 界面（`RecordSources`、确认框、记录少了横幅）。
- 临时库 `mirrai_v6_scratch`（push + migrate 到 0045）上 `db-records.test.ts` 8 通过。库已删。`mirrai_live` 未碰。
- 闸门 `308 passed | 3 skipped (311)` 文件，`2817 passed | 16 skipped (2833)` 用例，`all six steps passed`。相对 C1.5 闸门（305/3 文件、2805/15 用例）：通过文件 +3、通过用例 +12；跳过用例 +1（偏差 51）。
- C1.6 标 ✅。C1.7 起未做。未验证清单无新增。待用户决定仍空。

### WP1 · 实现会话 · 2026-11-16 · C1.7

- 分支 `exec/v6`。无独立验收遗留项。
- C1.7 一个提交：`825c73c`。勾选的手机号 / 身份证 / 邮箱 / 卡号 / 名字在写库前换成记号；`parseReport` 只记勾了哪些和替换次数；向导预览实时反映；分身名和用户名忽略；`TagInput` 提到共用组件。
- 验收命令（无 `DATABASE_URL`）：`vitest run server/importers/redact.test.ts server/routers-v6/import.test.ts client/src/components/v6/ImportWizard.test.tsx` → 3 文件 25 通过。闸门 `309 passed | 3 skipped (312)` 文件，`2828 passed | 16 skipped (2844)` 用例，`all six steps passed`。相对 C1.6 闸门（308/3 文件、2817/16 用例）：通过文件 +1、通过用例 +11；跳过数不变。
- `mirrai_live` 未碰。本条无临时库。
- C1.7 标 ✅。WP1 可做条目全部完成。独立验收另开会话。未验证清单无新增。待用户决定仍空。

### WP1 · 独立验收 · 2026-11-17

对照 `docs/exec-v6.md` 的 WP1 重跑，不沿用上面的证据。`corepack pnpm gate`（无 `--fast`、无 `DATABASE_URL`）退出码 0：`Test Files  309 passed | 3 skipped (312)`，`Tests  2828 passed | 16 skipped (2844)`，与本文件 C1.7 一行一致。通过数 2828，高于基线 2486。跳过数 16，高于基线 8；多出的 8 条都在 `server/db-records.test.ts` 的 `describe.skipIf(!DATABASE_URL)` 里。临时库 `mirrai_v6_verify` 上这 8 条全过，库已 `dropdb`。`mirrai_live` 未碰。

0045 四步：`drizzle-kit push --force` 后 `migrate.mjs` 应用到 0045；`--replay` 重放 43 条（两份无标记快照跳过）。`--rollback 1` 之后 `kind` / `speaker` / `fileId` / `lineNo` / `meta`、`parseStatus` / `parseReport`、两个新索引消失，`file_type` 里的 `chat_export` 和 `archive` 也消失；再 `migrate` 都回来。升级路径：手动丢掉这些列和索引，从 `schema_migrations` 删掉版本 `0045_records_columns`，再 `migrate`，列和索引出现。

提交范围 `6cf669d..HEAD`：没有 `Co-Authored-By`；`package.json` 只新增白名单里的 `fflate` 0.8.3；没有改 `server/wechat/ilink` 或已有迁移；没有删测试文件。已有测试的 diff 是加断言，没有放宽。黄金快照最后一次改动仍是 `e506484`。

先红后绿（临时改完用 `git checkout HEAD -- <文件>` 恢复，没有提交）：拿掉 `file.upload` 里的 `startImport`，`exemplars-upload.test.ts` 红在 `expected 0 to be greater than 0`。`guessRoles` 不再读 `fromMe`，`csv-not-unlabelled.test.ts` 红在 `expected null not to be null`。`toMinerRows` 全部标成 `other`，`pipeline-v5-seam.test.ts` 的文本用例红在 `actProfile` `expected null to be truthy`，结构化用例仍绿。

A1、A2、A3、C1.1、C1.4、C1.5、C1.6 维持 ✅。A4、C1.2、C1.3、C1.7 改回 ⬜。

- [x] C1.2 角色没经向导确认就入库。`cf3214d`。`startImport` 没有 `me` / `them` 时一律停在 `needs_roles`，猜测放进 `suggested`。上传和 `resume` 的测试断言不再调用写库。
- [x] C1.2 选格式、选会话、失败重试也会写库。`cf3214d`。这三条都走 `resume`，而 `resume` 不带角色，所以现在也不会写。`import.test.ts` 覆盖了角色猜得出时 `resume` 的 `written: 0`。
- [x] C1.7 自动写入之后再脱敏，原文还在。`cf3214d`。再次 `confirm` 先 `deleteRecordsByFile`，再写入脱敏后的行。测试断言第二次内容是「打 [phone]」，并且按这个文件的 id 删过旧行。
- [x] C1.3 夹具的表情、语音、通话经 `wechat-csv` 往返后没有了。`b1ba852`。渲染带上 Type 和表情键、转写、方向、模式；`wechat-csv.test.ts` 对夹具的 sticker / voice / call 断言 `kind`、`content`、`meta` 都回来。
- [x] A4 时期不是两条，边界也不是 2023-07-05。`c46b0d7`。活跃日除静默外间隔不超过 13 天，静默后第一天是 2023-07-05。`pipeline-v5-seam.test.ts` 断言 `periods.length === 2`，边界落在 2023-07-05。

### WP1 · 实现会话 · 2026-11-17 · 独立验收修复

- `cf3214d` 修 C1.2 和 C1.7。`b1ba852` 修 C1.3。`c46b0d7` 修 A4。
- 闸门 `309 passed | 3 skipped (312)` 文件，`2832 passed | 16 skipped (2848)` 用例，`all six steps passed`。通过数比验收时的 2828 多 4，跳过数仍是 16。
- A4、C1.2、C1.3、C1.7 改回 ✅。

验不了：C1.2 的浏览器拖放没有重做。同一份 `server/test-fixtures/exports/wechat-txt-2line/sample.txt` 在临时库上，不给角色时 `needs_roles`、写入 0；`me: ["阿树"]`、`them: ["小满"]` 后写入 13（多行并成一条，正文里的假时间头还在，撤回行是 `other` / `system` / `[recall]`）。向导的英文界面没有在浏览器里点过；`renderRecordContent` 的英文通话句跑过，文案审计是 0。

### WP1 · 独立验收 · 2026-11-17 · 修复后再验

对照当前 `exec/v6` HEAD `7d512ed` 重跑，不沿用上面的证据。`corepack pnpm gate`（无 `--fast`、无 `DATABASE_URL`）退出码 0：`Test Files  309 passed | 3 skipped (312)`，`Tests  2832 passed | 16 skipped (2848)`，`all six steps passed`。与本文件「独立验收修复」一行一致。通过数 2832，高于基线 2486。跳过数 16，高于基线 8；多出的 8 条是 `server/db-records.test.ts` 的 `describe.skipIf(!DATABASE_URL)`。临时库 `mirrai_v6_verify` 上这 8 条，加上 `idempotency-db` 3 条、`db-unique-indexes` 5 条，共 16 条全过。库已 `dropdb`。`mirrai_live` 未碰。

0045 四步：`drizzle-kit push --force` 后 `migrate.mjs` 应用到 0045；`--replay` 重放 43 条（两份无标记快照跳过）。`--rollback 1` 之后 `kind` / `speaker` / `fileId` / `lineNo` / `meta`、`parseStatus` / `parseReport`、两个新索引消失，`file_type` 里的 `chat_export` 和 `archive` 也消失；再 `migrate` 都回来。升级路径：手动丢掉这些列和索引，从 `schema_migrations` 删掉 `0045_records_columns`，再 `migrate`，列和索引出现。枚举值这次没有手工删（down 段才会重建枚举），所以升级路径前后 `chat_export` / `archive` 一直在。

提交范围 `6cf669d^..HEAD`：没有 `Co-Authored-By`；`package.json` 只新增白名单里的 `fflate` 0.8.3；没有改 `server/wechat/ilink` 或已有迁移；没有删测试文件。已有测试的 diff 是加断言。黄金快照最后一次改动仍是 `e506484`。

先红后绿（临时改完用 `git checkout HEAD -- <文件>` 恢复，工作区已干净，没有提交）：`guessRoles` 不再读 `fromMe`，`csv-not-unlabelled.test.ts` 红在 `expected null not to be null`。`toMinerRows` 全部标成 `other`，`pipeline-v5-seam.test.ts` 的文本用例红在 `actProfile` `expected null to be truthy`，结构化用例仍绿。`importRecords` 开头直接 `return 0`，`exemplars-upload.test.ts` 红在 `expected 0 to be greater than 0`。

A1、A2、A3、C1.3、C1.4、C1.5、C1.6、C1.7 维持 ✅。C1.1、A4、C1.2 改回 ⬜。

- [x] C1.1 WhatsApp 的 `M/D/YY` 在日、月都不大于 12 时被读成日月颠倒。短日期在没有「大于 12」的证据时按月日读；文件里有大于 12 的日或月时仍按那个证据。`whatsapp-txt.test.ts` 断言 `3/1/22, 8:05:09 PM` 是 `2022-03-01T12:05:09.000Z`，`3/5/22, 9:00 AM` 是 `2022-03-05T01:00:00.000Z`；`13/3/22` 旁边的 `1/3/22` 仍是 3 月 1 日；`[2022/3/1]` 旁边的 `3/1/22, 20:05` 是 `2022-03-01T12:05:00.000Z`。样本里的 Android 行改成 `3/1/22`，并断言「好」是 `2022-03-01T12:00:00.000Z`。
- [x] A4 文本路径的时期边界跟着进程时区走。`coerceTimestamp` 对不带时区的字符串走 `parseExportTime`，不再用 `new Date`。缝测试传入 `Asia/Shanghai`。蒸馏入口把 `getUserTimezone` 的结果传进 `runSkillPipeline`。`TZ=UTC` 下 `pipeline-v5-seam.test.ts` 两条都绿。
- [x] C1.2 一个 zip 里有多份聊天文件时条数全是 0。`sourceFromArchive` 对每个已认出的文件跑解析，把 `records.length` 放进 `chats[].count`。`archive-counts.test.ts`：`a.txt` 2 条、`b.txt` 1 条，状态 `needs_chat`，写入 0。

### WP1 · 实现会话 · 2026-11-17 · 独立验收再修

- `36b0aff` 修 C1.1。`969cfcd` 修 A4。`72034cf` 修 C1.2。
- `TZ=UTC` 下 `pipeline-v5-seam.test.ts` 2 通过。WhatsApp 三条新断言和 zip 条数测试通过。
- 闸门 `310 passed | 3 skipped (313)` 文件，`2836 passed | 16 skipped (2852)` 用例，`all six steps passed`。通过数比验收时的 2832 多 4，跳过数仍是 16。
- C1.1、A4、C1.2 改回 ✅。偏差 56 记下短日期的默认顺序。

### WP2 · 实现会话 · 2026-11-17 · A5

- 分支 `exec/v6`。独立验收留下的 `- [ ]` 已全部勾掉。没有「等 xxx」的推后项。
- A5 一个提交：`21981ee`。删掉 `DailyMessages`、挂载点和 `lobby.daily` 中英文案。原位置先空着，C2.1 再放「那年今天」。
- 先红后绿（亲自跑过）：写断言后、删组件前，`Lobby.test.tsx` 红在「TA 想对你说」。
- 闸门 `310 passed | 3 skipped (313)` 文件，`2837 passed | 16 skipped (2853)` 用例，`all six steps passed`。相对 WP1 闸门（310/3 文件、2836/16 用例）：通过用例 +1；跳过数不变。
- `mirrai_live` 未碰。本条无临时库。
- A5 标 ✅。A6 起未做。

### WP2 · 实现会话 · 2026-11-17 · A6

- A6 一个提交：`8614668`。`getPersonasWithStats` 一次查出 `relationshipEnded`；`mayFeature` 管推荐和今日话题；卡片改成 `chat.lastContact`；删掉 `getMissYouLevel` / `lobby.missYou`。
- 先红后绿（亲自跑过）：三条大厅断言在改代码前红（「很想你」、推荐标题、「上次联系 3 天前」）。
- 闸门 `311 passed | 3 skipped (314)` 文件，`2847 passed | 16 skipped (2863)` 用例。相对 A5（310/3 文件、2837/16 用例）：通过文件 +1、通过用例 +10；跳过数不变。
- A6 标 ✅。A7 起未做。

### WP2 · 实现会话 · 2026-11-17 · A7

- A7 两个提交。`8ceb9b8` 删掉 `ChatStreak`、`AchievementBadges`、`PersonaLeaderboard`、`ACHIEVEMENTS`，以及 `lobby.achievements` / `lobby.streak` / `lobby.leaderboard` 和 Analytics 的最长连续卡。`3b5575e` 加 `user.milestones` / `getUserMilestones`，大厅原成就位置挂 `Milestones`（只列出已经发生的）。
- 先红后绿（亲自跑过）：写断言后、删组件前，大厅有「连续对话 2 天」。
- 闸门 `313 passed | 3 skipped (316)` 文件，`2854 passed | 16 skipped (2870)` 用例，`all six steps passed`。相对 A6（311/3 文件、2847/16 用例）：通过文件 +2、通过用例 +7；跳过数不变。
- 偏差 58：第一封信只计 `kind = "letter"`。待用户决定新增亲密度连续天数是否拿掉。
- `mirrai_live` 未碰。本条无临时库。
- A7 标 ✅。A8 起未做。

### WP2 · 实现会话 · 2026-11-17 · A8

- A8 两个提交。`2cfd462`：抽取每条必须带 `line`；应用内来源是分身的不存，计入 `fromPersona`；没有合法 `line` 计入 `skipped`；上传记录两边都是真的，照常存。提示词 `prompts.memoryExtraction` 补了 `line` 和「对方的话不是事实来源」。`0be929c`：`memory.listFromPersona` / `keepFromPersona`，聊天记忆面板顶部挂 `MemoryReview`。
- 先红后绿（亲自跑过）：旧代码把「我周三下午有课」存成锚点。
- 闸门 `315 passed | 3 skipped (318)` 文件，`2861 passed | 16 skipped (2877)` 用例，`all six steps passed`。相对 A7（313/3 文件、2854/16 用例）：通过文件 +2、通过用例 +7；跳过数不变。
- `mirrai_live` 未碰。本条无临时库。
- A8 标 ✅。A9 起未做。

### WP2 · 实现会话 · 2026-11-17 · A9

- A9 一个提交：`6ebeea3`。`CrisisResource` 加 `source`。四条都核到，`lastVerified` 改为 2026-11-17。`KNOWN_UNVERIFIED` 为空。
- 亲自打开并看到的页面：
  - `cn-national` 12356：https://www.ndcpa.gov.cn/jbkzzx/c100009/common/content/content_1925026893781176320.html（curl 200）「全国 31 个省（区、市）均已开通运行“12356”心理援助热线」。卫健委设号通知 https://www.nhc.gov.cn/yzygj/c100068/202412/49a1a65386cd4be582d4702fd0926ee8.shtml 本机 412，检索结果里有全文（国卫医政函〔2024〕259 号设 12356），不当作打开的来源。
  - `cn-beijing` 010-8295-1332：https://www.crisis.org.cn/lists/5.html 「手机：010-82951332」，描述仍是心理危机研究与干预中心。号码分组写法未改。
  - `intl-directory` https://findahelpline.com：打开 https://findahelpline.com/ ，目录在线；IASP https://www.iasp.info/crisis-centres-helplines/ 写明与 ThroughLine / Find A Helpline 合作。
  - `us-ca` 988：https://988lifeline.org/ 「national mental health hotline: 988」；SAMHSA https://www.samhsa.gov/mental-health/988 Last Updated 09/26/2025；加拿大 https://www.canada.ca/en/public-health/services/suicide-prevention/government-canada-doing-help-prevent-suicide.html 「call or text 9-8-8」。
- `egress.test.ts` 4 通过。应用仍不联网取这些号码。
- 闸门 `315 passed | 3 skipped (318)` 文件，`2863 passed | 16 skipped (2879)` 用例，`all six steps passed`。相对 A8（315/3 文件、2861/16 用例）：通过用例 +2；跳过数不变。
- `mirrai_live` 未碰。本条无临时库。
- 偏差 59：12356 的 `source` 用疾控局发布会页。未验证清单无新增。待用户决定无新增。
- A9 标 ✅。WP2 可做条目全部完成。独立验收另开会话。

### WP2 · 独立验收 · 2026-11-17

对照 `docs/exec-v6.md` 的 A5–A9 重跑，不沿用上面的证据。`corepack pnpm gate`（无 `--fast`、无 `DATABASE_URL`）退出码 0：`Test Files  315 passed | 3 skipped (318)`，`Tests  2863 passed | 16 skipped (2879)`，`all six steps passed`。与本文件 A9 一行一致。通过数 2863，高于基线 2486。跳过数 16，和 WP1 收尾相同，这一包没有再增加；相对手册基线 8 的差额来自更早的 `db-records.test.ts` `skipIf`。

提交范围 `21981ee^..HEAD`：没有 `Co-Authored-By`；`package.json` 没有新增依赖；没有改 `server/wechat/ilink` 或已有迁移；没有删测试，没有拿掉已有 `expect`，没有加 `skip`。`server/chat/memory-extract.test.ts` 只给 mock 补了 `line`，补的那一行在夹具里是用户说的（偶数 id）。黄金快照最后一次改动仍是 `e506484`。各提交的文件和说明对得上，记进度的提交只改了这个文件。这一包没有新迁移，没有做手册 2.3 的四步。临时库 `mirrai_v6_verify` 上跑了里程碑、关系是否结束、分身来源记忆，用完已 `dropdb`。`mirrai_live` 未写。

先红后绿（临时改完用 `git checkout HEAD -- <文件>` 恢复，没有提交）：A5 把大厅和中英文案倒回 `21981ee` 之前，测试红在页面上有「TA 想对你说」。A6 倒回 `8614668` 之前，三条都红：页面上有「很想你」；找不到标题「接着聊」；卡片没有「上次联系 3 天前」。A7 倒回 `8ceb9b8` 之前，大厅红在「连续对话 2 天」，统计页红在「最长连续」。A8 把 `memory-extract.ts` 倒回 `2cfd462` 之前，`does not store a fact the persona said` 红在 `createMemory` 被调用，存的是「周三下午有课」。A9 把 `cn-national` 的 `lastVerified` 改回 `2026-01-01`，`resources.test.ts` 红在这个占位日期。

A5、A7、A9 维持 ✅。A6、A8 改回 ⬜。

- [x] A6 验收要求一个暂停的分身那一页上没有「想你」。`d9f679d`。引言第 1 句改为「所谓永恒，就是把日子一天一天过完。」，第 3 句改为「安静下来的时候，连呼吸都慢了。」用例改为断言 `lobby.quotes` 每一句都不含「想你」，不再把 `Math.random` 钉死。
- [x] A8 上传记录走的仍是同一条 `prompts.memoryExtraction`。`d14ba9d`。「重建出来的」挪到 `prompts.memoryExtractionInApp`，只在没有 `history` 时接上。上传路径的系统提示词不含这句，仍要求 `line`。见偏差 60。
- [x] A7 `server/routers.milestones.test.ts` 把 `getUserMilestones` 整个 mock 掉。`1e5dec4`。`db-behaviour.test.ts` 断言三条查询分别过滤 `letters.userId` 且 `kind = "letter"`、`outbound_letters.userId`、`personas.userId`。路由测试仍只检查把 `ctx.user.id` 传进去。

### WP2 · 实现会话 · 2026-11-17 · 独立验收修复

- `d9f679d` 修 A6。`d14ba9d` 修 A8。`1e5dec4` 修 A7 的查询测试。
- 闸门 `315 passed | 3 skipped (318)` 文件，`2865 passed | 16 skipped (2881)` 用例，`all six steps passed`。通过数比验收时的 2863 多 2，跳过数仍是 16。
- A6、A8 改回 ✅。存疑三项当时未改。

### WP2 · 实现会话 · 2026-11-17 · 存疑三处

- `94f72d2` 快捷栏改走 `mayFeature`。暂停的分身留在卡片上，不进「继续对话」。这一栏的小标题从「接着聊」改成「快捷」，英文 `Shortcut`。
- `17b934c` 美加拆成 `us` 和 `ca`。美国来源 https://988lifeline.org/ ，页面写 national mental health hotline: 988，描述「自杀与危机生命线」。加拿大来源 https://www.canada.ca/en/public-health/services/suicide-prevention/government-canada-doing-help-prevent-suicide.html ，当天又打开，写 call or text 9-8-8，服务名是 9-8-8: Suicide Crisis Helpline，描述「自杀危机援助热线」。`us-ca` 和「美国 / 加拿大」文案已删。`lastVerified` 仍是 2026-11-17。
- `ef25b46` `getMemoriesFromPersona` 加上 `status = "active"`。已取代的行留在库里，不再进核对列表。普通记忆列表没动。
- 闸门 `315 passed | 3 skipped (318)` 文件，`2868 passed | 16 skipped (2884)` 用例，`all six steps passed`。通过数比上一闸门 2865 多 3，跳过数仍是 16。

### WP3 · 实现会话 · 2026-11-17 · B1.1

- 独立验收留下的 `- [ ]` 无。进度表里没有「等 xxx」的推迟项。
- 共用迁移 `93aa60d`：`distillation_chunks` / `distillation_cards` / `persona_versions`，memories 三列，records 的 act/emotion 四列。
- 切块 `1fd5c18`。map 与存卡 `14faa43`。reduce 与接入 `a488610`（`startPersonaDistillation` 不再把记录读进内存；失败超三成不重试）。预估与界面 `e15dc9a`。
- 0046 临时库四步+升级路径见进度表。`mirrai_live` 未碰。
- 闸门 `318 passed | 3 skipped (321)` 文件，`2897 passed | 16 skipped (2913)` 用例，`all six steps passed`。相对 WP2 收尾（315/3 文件、2868/16 用例）：通过文件 +3、通过用例 +29；跳过数不变。
- 偏差 61–64。未验证清单无新增。待用户决定无新增。
- B1.1 标 ✅。下一条 B1.2。

### WP3 · 实现会话 · 2026-11-17 · B1.2

- `dbd08ca` `selectChunks`：必留第 1 块和最后 3 块，其余按时期 × 昼夜 × 疏密分层，层内 `seededRandom(seed)`。`takeChunkBudget` / 预估 / map 都走这一抽。种子 `distill:<personaId>:<块数>`。
- `chunks.test.ts` 新增 3 条全过。`pipeline-chunked.test.ts` 7 通过。闸门 `318 passed | 3 skipped (321)` 文件，`2900 passed | 16 skipped (2916)` 用例，`all six steps passed`。相对 B1.1（2897/16）：通过用例 +3；跳过数不变。
- 情绪维等 B1.5 写回 `emotion` 后再乘。偏差无新增。未验证清单、待用户决定无新增。
- B1.2 标 ✅。下一条 B1.3。

### WP3 · 实现会话 · 2026-11-17 · B1.3

- `c1e9484` `isMemoryDate` 挪到 `shared/memory-date.ts`；`shared/fact-cues.ts`；`prompts.distill.factCard`；`facts.ts` 校验引用并落库。
- `ce3c3d9` 有结构化记录时走事实抽取，删掉这条路径上「前 50 行 `extractMemories`」；有 `source: records` 的记忆时不再用文件摘要候选。老的纯上传文本路径仍走 `extractMemories`。
- 闸门 `321 passed | 3 skipped (324)` 文件，`2920 passed | 16 skipped (2936)` 用例，`all six steps passed`。相对 B1.2（318/3 文件、2900/16 用例）：通过文件 +3、通过用例 +20；跳过数不变。
- 偏差 65：预估不含事实卡。未验证清单、待用户决定无新增。
- B1.3 标 ✅。下一条 B1.4。

### WP3 · 实现会话 · 2026-11-17 · B1.4

- `89d0048` `precisionOnly` 只留 silence / acknowledge / repair；新增 `USER_ACTS` 与 `labelUserActByRule`（「在吗」靠句末「吗」，因为疑问词开头锚点吃不到）。
- `ade38b6` `labelActsForRecords` 按月分层取样、每批 60 对、围栏包好；`act` 写在 TA 一轮第一行，`prevAct` 写在用户一轮最后一行；`buildActProfile` 只计已标注行，无情绪的行不进带情绪的桶。蒸馏管线排在 `buildActProfile` 之前。`updateRecordLabels` 查询带 `eq(collectedMessages.userId, userId)`。
- 闸门 `323 passed | 3 skipped (326)` 文件，`2931 passed | 16 skipped (2947)` 用例，`all six steps passed`。相对 B1.3（321/3 文件、2920/16 用例）：通过文件 +2、通过用例 +11；跳过数不变。
- 偏差 66。未验证清单、待用户决定无新增。
- B1.4 标 ✅。下一条 B1.5。

### WP3 · 实现会话 · 2026-11-17 · B1.5

- `db75f76` 场景为单位：触发词命中 ≥2 且一态占多数则 `emotionSource: rule`；否则 standard 按月取 600 个场景、deep 全部、fast 不调模型。状态写在该场景 TA 的每一行上，不定的保持空，不默认 `warm`。管线排在动作标注之后、`buildActProfile` 之前。
- 闸门 `324 passed | 3 skipped (327)` 文件，`2935 passed | 16 skipped (2951)` 用例，`all six steps passed`。相对 B1.4（323/3 文件、2931/16 用例）：通过文件 +1、通过用例 +4；跳过数不变。
- 偏差 67。未验证清单、待用户决定无新增。
- B1.5 标 ✅。下一条 C10.1。

### WP3 · 实现会话 · 2026-11-17 · C10.1

- `178f815` 四类线索词、`findHarmCandidates` / `confirmHarmFromRecords`（一类 ≥3 条才问模型，最多送 20 条），确认后仍 ≥3 的类写入 `personaData.harmReport`，默认 `pending`。`mergeUserDecisions` 保住已做的决定。
- `4bde47e` `filterHarm` 接到示范检索和生成；`pending`/`remove` 在底线后加固定指令且在围栏外，`keep` 不加。
- `092e6b8` `HarmNotice` 挂在上传页就绪卡片和人设编辑页；`persona.decideHarm` 走 `withPersonaDataLock`。文案不含「家暴」「PUA」「有毒」。
- 闸门 `330 passed | 3 skipped (333)` 文件，`2957 passed | 16 skipped (2973)` 用例，`all six steps passed`。相对 B1.5（324/3 文件、2935/16 用例）：通过文件 +6、通过用例 +22；跳过数不变。
- 偏差无新增。未验证清单、待用户决定无新增。
- C10.1 标 ✅。下一条 B1.6。

### WP3 · 实现会话 · 2026-11-17 · B1.6

- `4709167` 闭集 `pickClarifications` / `applyClarification`；`personaData.clarified`；`mergeUserDecisions` 保住已答。计数走 `iterateRecords`（第 3.1 节：读全部记录必须分页）。
- `ada73e8` `persona.clarifications` / `answerClarification`（`withPersonaDataLock`）；`ClarifyCard` 挂在上传页就绪卡片下，一次一题。
- 闸门 `333 passed | 3 skipped (336)` 文件，`2986 passed | 16 skipped (3002)` 用例，`all six steps passed`。相对 C10.1（330/3 文件、2957/16 用例）：通过文件 +3、通过用例 +29；跳过数不变。
- 偏差 68。未验证清单、待用户决定无新增。
- B1.6 标 ✅。下一条 B1.7。

### WP3 · 实现会话 · 2026-11-17 · B1.7

- `8499939` map 前按 `(chunkHash, phase=observation)` 复用已存卡；归并仍每次重跑；成功后 `deleteOrphanDistillationCards` 清掉当前切块集合之外的卡。进度文案 `distill.reusedChunks`。
- 闸门 `333 passed | 3 skipped (336)` 文件，`2990 passed | 16 skipped (3006)` 用例，`all six steps passed`。相对 B1.6（333/3 文件、2986/16 用例）：通过用例 +4；跳过数不变。
- 偏差无新增。未验证清单、待用户决定无新增。
- B1.7 标 ✅。下一条 B1.8。

### WP3 · 实现会话 · 2026-11-17 · B1.8

- `420ef23` `EVIDENCE_FIELD_DIMENSIONS`；`persona.evidence` 观察卡按维最多 30 张倒序；`EvidenceList` 可展开原话（日期 · 说话人 · 原文），无卡标「推断」。C2.10 落地前不跳转。
- 闸门 `336 passed | 3 skipped (339)` 文件，`3000 passed | 16 skipped (3016)` 用例，`all six steps passed`。相对 B1.7（333/3 文件、2990/16 用例）：通过文件 +3、通过用例 +10；跳过数不变。
- 偏差无新增。未验证清单、待用户决定无新增。
- B1.8 标 ✅。下一条 B1.9。

### WP3 · 实现会话 · 2026-11-17 · B1.9

- `f965f92` `createPersonaVersion` / `prunePersonaVersions`（每分身 20 版）；蒸馏写回前 `reason: "distill"`。
- `298a524` `personaVersion.list` / `diff` / `restore`（`withPersonaDataLock`）；编辑/修正前存版；`eval.run` 把最新版本 id 写入 `metricsJson.personaVersionId` 并回写 `evalRunId`。`VersionHistory` 挂在人设编辑页。
- 闸门 `338 passed | 4 skipped (342)` 文件，`3006 passed | 18 skipped (3024)` 用例，`all six steps passed`。相对 B1.8（336/3 文件、3000/16 用例）：通过文件 +2、通过用例 +6；跳过文件 +1、跳过用例 +2（偏差 69）。
- 偏差 69。未验证清单、待用户决定无新增。
- B1.9 标 ✅。下一条 B1.10。

### WP3 · 实现会话 · 2026-11-17 · B1.10

- `26df59c` `measureUserSide`（满 40 条用户文本才出画像；12 句长度在四分位距内、按时间均匀取）；`measureStyleProfile` 写入 `styleProfile.userSide`。不进提示词。指纹等 B3.1。
- 闸门 `339 passed | 4 skipped (343)` 文件，`3009 passed | 18 skipped (3027)` 用例，`all six steps passed`。相对 B1.9（338/4 文件、3006/18 用例）：通过文件 +1、通过用例 +3；跳过数不变。
- 偏差无新增。未验证清单、待用户决定无新增。
- B1.10 标 ✅。WP3 的 B1.1–B1.10、C10.1 全部完成。不开始 WP4。

### WP3 · 独立验收 · 2026-11-17

对照 `docs/exec-v6.md` 的 B1.1–B1.10、C10.1 重跑，不沿用上面的证据。`corepack pnpm gate`（无 `--fast`、无 `DATABASE_URL`）退出码 0：`Test Files  339 passed | 4 skipped (343)`，`Tests  3009 passed | 18 skipped (3027)`，`all six steps passed`。与本文件 B1.10 一行一致。通过数 3009，高于基线 2486。跳过数 18，高于基线 8，也比 WP3 开工前的 16 多 2。多出来的 2 条是 `server/db-persona-versions.test.ts` 的 `describe.skipIf(!DATABASE_URL)`（偏差 69）。临时库 `mirrai_v6_verify` 上这 2 条，加上 `db-records`、`db-unique-indexes`、`idempotency-db`、`db-delete-coverage`，共 5 个文件、27 条全过。库已 `dropdb`。`mirrai_live` 未碰。

0046 四步：`drizzle-kit push --force` 后 `migrate.mjs` 应用到 `0046_distillation_tables`；`--replay` 重放 44 条（两份无标记快照跳过）。`--rollback 1` 之后 `distillation_chunks`、`distillation_cards`、`persona_versions` 消失，`memories` 的 `recordId` / `source` / `mentionCount` 和 `collected_messages` 的 `act` / `actSource` / `emotion` / `emotionSource` 也消失；再 `migrate` 都回来。升级路径：手动丢掉这三张表和七列，从 `schema_migrations` 删掉 `0046_distillation_tables`，再 `migrate`，表和列出现。

提交范围 `93aa60d^..HEAD`：没有 `Co-Authored-By`；`package.json` 没有新增依赖；没有改 `server/wechat/ilink` 或已有迁移；没有删测试，没有拿掉已有 `expect`，没有给已有用例加 `skip`。`server/skill-engine/pipeline.test.ts` 只补了 `iterateRecords` / `createDistillationChunk` / `createDistillationCard` 三个 mock 导出（偏差 64）。黄金快照最后一次改动仍是 `e506484`。记进度的提交只改了这个文件。`db75f76` 对 `label-acts.ts` 的改动是把 `sampleByMonth` 导出给情绪标注复用。

先红后绿（临时改完用 `git checkout HEAD -- <文件>` 恢复，没有提交）：B1.4 把 standard 的标注预算改回 80，`acts-coverage.test.ts` 红在 `expected 80 to be greater than 200`。B1.5 把 `buildActProfile` 的桶情绪改回恒定 `warm`，`act-buckets-emotion.test.ts` 红在 `expected 0 to be greater than 0`（`emotion: "distant"` 的桶是 0 个）。

B1.1、B1.3、B1.4、B1.5、C10.1、B1.6、B1.7、B1.8、B1.10 维持 ✅。B1.2、B1.9 改回 ⬜。

- [x] B1.2 抽样没有乘上主要情绪。`99e8b2f`。层键在块里 TA 的行有唯一多数情绪时加上那一维；没有标注，或两种情绪打平，不加。用户行上的情绪不算。`chunks.test.ts`：前一块和最后三块是 warm，中间有 distant，budget 6 会抽到 distant；去掉全部标注后抽出的块不一样。
- [x] B1.9 「蒸馏写回前后各一版」没有测到蒸馏。`77b0421`。`commitDistilledPersona` 在写回前存一版、写回后再存一版，reason 都是 `distill`。临时库上的测试改走这个函数：旧版「短句」、新版「更短」、人设是「更短」。测试不再自己调用 `createPersonaVersion`。

### WP3 · 实现会话 · 2026-11-17 · 独立验收修复

- `99e8b2f` 修 B1.2。有情绪标注的块按主要情绪再分一层。
- `77b0421` 修 B1.9。蒸馏写回前后各存一版。
- 闸门 `339 passed | 4 skipped (343)` 文件，`3010 passed | 18 skipped (3028)` 用例，`all six steps passed`。通过数比验收时的 3009 多 1，跳过数仍是 18。
- 临时库 `mirrai_v6_verify` 上 `db-persona-versions.test.ts` 2 通过。库已 `dropdb`。`mirrai_live` 未碰。
- B1.2、B1.9 改回 ✅。

### WP4 · 实现会话 · 2026-11-17 · B3.1

- 独立验收留下的 `- [ ]` 无。进度表里没有「等 xxx」的推迟项。
- `00d6e7a` 测量：`shared/style-fingerprint.ts`，`measureStyleProfile` 写入 `styleProfile.fingerprint` 和 `userSide.fingerprint`。`e774ee2` 界面：`FingerprintView` 挂在保真面板。
- 闸门 `341 passed | 4 skipped (345)` 文件，`3037 passed | 18 skipped (3055)` 用例，`all six steps passed`。相对 WP3 收尾（339/4 文件、3010/18 用例）：通过文件 +2、通过用例 +27；跳过数不变。
- 偏差 70、71。未验证清单、待用户决定无新增。
- B3.1 标 ✅。下一条 B3.2。

### WP4 · 实现会话 · 2026-11-17 · B3.2

- `2e05643`：`styleDistance` / `lineSurprise` 进尺子；`aggregateScores` 有指纹才填、没有为 `null`；CLI 打印 `style`，`--compare` 列入对比，闸门容差 `--tolerance-style` 默认 0.05。`docs/eval/baseline.md` 第二节表加一行、第九节空表加 `style` 列。
- 闸门 `341 passed | 4 skipped (345)` 文件，`3042 passed | 18 skipped (3060)` 用例，`all six steps passed`。相对 B3.1（341/4 文件、3037/18 用例）：通过用例 +5；跳过数不变。
- 偏差、未验证清单、待用户决定无新增。
- B3.2 标 ✅。下一条 B8.7。

### WP4 · 实现会话 · 2026-11-17 · B8.7

- `dc2e6da`：`eval_cases.periodId`；`buildEvalCases` 按时期/情绪/白天夜里分层；默认 `maxCases` 为 TA 行数的 2%（12–60）；评测抽样用标答自己的状态和时段。
- 闸门 `341 passed | 4 skipped (345)` 文件，`3047 passed | 18 skipped (3065)` 用例，`all six steps passed`。相对 B3.2（341/4 文件、3042/18 用例）：通过用例 +5；跳过数不变。
- 偏差 72。未验证清单、待用户决定无新增。
- B8.7 标 ✅。下一条 B8.6。

### WP4 · 实现会话 · 2026-11-17 · B8.6

- `9c13769`：`--k` 每条标答生成 k 句再平均；自助法 95% 区间；`--compare` 三种结论（better / worse / within noise）；`--calibrate --save` 把容差写入 `metricsJson.tolerances`，`--gate` 优先用它。
- 闸门 `341 passed | 4 skipped (345)` 文件，`3054 passed | 18 skipped (3072)` 用例，`all six steps passed`。相对 B8.7（341/4 文件、3047/18 用例）：通过用例 +7；跳过数不变。
- 偏差、未验证清单、待用户决定无新增。
- B8.6 标 ✅。下一条 B8.1。

### WP4 · 实现会话 · 2026-11-17 · B8.1

- `e61eca3`：哈希 1–3 元 + 稠密特征的 L2 逻辑回归，五折按对切分；少于 60 对不训练。
- `cc0fa59`：`--discriminator` 并起本版本之后的对子，写入 `metricsJson.discriminator` 和 `styleProfile.discriminator`；`DiscriminatorView` 显示 AUC 和特征表。
- 闸门 `343 passed | 4 skipped (347)` 文件，`3067 passed | 18 skipped (3085)` 用例，`all six steps passed`。相对 B8.6（341/4 文件、3054/18 用例）：通过文件 +2、通过用例 +13；跳过数不变。
- 偏差 73。未验证清单、待用户决定无新增。
- B8.1 标 ✅。下一条 B8.2。

### WP4 · 实现会话 · 2026-11-17 · B8.2

- `c74ebb7`：`blind_sessions`、挑选规则、路由、导出 Markdown、访客 token 只存哈希。
- `906d812`：`/persona/:id/blind-test` 一组一组答。
- `9936193`：`/blind/:token` 不登录也能答。
- 闸门 `347 passed | 4 skipped (351)` 文件，`3087 passed | 18 skipped (3105)` 用例，`all six steps passed`。相对 B8.1（343/4 文件、3067/18 用例）：通过文件 +4、通过用例 +20；跳过数不变。
- 偏差、未验证清单、待用户决定无新增。
- B8.2 标 ✅。下一条 B8.3。

### WP4 · 实现会话 · 2026-11-17 · B8.3

- `9babf31`：`runDrift` 从一条标答的上下文起步，模拟用户与分身交替 50 轮，按 10 轮一窗记 surprise / 残渣 / `styleDistance`，输出斜率与第一个高出首窗 0.1 的窗。历史只在内存里。没有 `userSide.sampleLines` 时报「记录里你这一侧的话不够，模拟不了」。CLI `--drift [--turns N]`，`--save` 的 `variant` 为 `drift`。
- 闸门 `348 passed | 4 skipped (352)` 文件，`3094 passed | 18 skipped (3112)` 用例，`all six steps passed`。相对 B8.2（347/4 文件、3087/18 用例）：通过文件 +1、通过用例 +7；跳过数不变。
- 偏差、未验证清单、待用户决定无新增。
- B8.3 标 ✅。下一条 B8.4。

### WP4 · 实现会话 · 2026-11-17 · B8.4

- `55f47b3`：`runAudition` 对每个环境/用户配置的 provider 用同一套标答跑评测（不重排，k=1）；失败记下原因继续；综合分是本批 z 分数平均。CLI `--audition`；`eval.audition` `RATE_LIMITS.llmHeavy`，同一用户同时一场。
- `2e5314b`：保真面板「试镜」表，点「给这个分身用它」写 `personas.llmProvider`。
- 闸门 `350 passed | 4 skipped (354)` 文件，`3101 passed | 18 skipped (3119)` 用例，`all six steps passed`。相对 B8.3（348/4 文件、3094/18 用例）：通过文件 +2、通过用例 +7；跳过数不变。
- 偏差 74。未验证清单、待用户决定无新增。
- B8.4 标 ✅。下一条 B8.5。

### WP4 · 实现会话 · 2026-11-17 · B8.5

- `23bd6fc`：`--ablate` 先打印（层数+1）×标答×k；没有 `--yes` 不调模型。有 `--yes` 时先跑默认，再对 `layersUsed` 并集各关一层，结论用 B8.6 三种。`--save` 的 `variant` 为 `ablate`。
- 闸门 `350 passed | 4 skipped (354)` 文件，`3103 passed | 18 skipped (3121)` 用例，`all six steps passed`。相对 B8.4（350/4 文件、3101/18 用例）：通过用例 +2；跳过数不变。
- 偏差、未验证清单、待用户决定无新增。
- B8.5 标 ✅。下一条 B8.8。

### WP4 · 实现会话 · 2026-11-18 · B8.8

- 分支 `exec/v6`。独立验收留下的 `- [ ]` 无。没有「等 xxx」的推后项。
- `26e83a6`：表 `fidelity_pairs`、生成路径在网页每 8 轮出 `choice`、通道只一句、`fidelity.choose` 落库并写对、30 对训 `rerankWeights`。
- `ef5bead`：`ChoiceBubble`、开关「偶尔让我二选一」、流式 `choice` 事件。
- 闸门 `353 passed | 4 skipped (357)` 文件，`3120 passed | 18 skipped (3138)` 用例，`all six steps passed`。相对 B8.5（350/4 文件、3103/18 用例）：通过文件 +3、通过用例 +17；跳过数不变。
- 偏差 75、76。未验证清单、待用户决定无新增。
- B8.8 标 ✅。下一条 B8.9。

### WP4 · 实现会话 · 2026-11-18 · B8.9

- `600eca3`：保真面板挂 `FidelityHistory`。`eval.list` 画 overlap / likelihoodGap / styleDistance / AUC 曲线，点带 B8.6 `ci`；人设版本竖线；蒸馏前后两列加 B8.6 结论；最近一次 `--ablate` 表；最近三场盲测。
- `FidelityHistory.test.tsx` 5 通过。`routers.blind.test.ts` 新增 `blind.list` 只返回 3 场、别人的分身 `NOT_FOUND`。
- 闸门 `354 passed | 4 skipped (358)` 文件，`3126 passed | 18 skipped (3144)` 用例，`all six steps passed`。相对 B8.8（353/4 文件、3120/18 用例）：通过文件 +1、通过用例 +6；跳过数不变。
- 偏差、未验证清单、待用户决定无新增。
- B8.9 标 ✅。下一条 B8.10。

### WP4 · 实现会话 · 2026-11-18 · B8.10

- `e80c4d0`：`material.report` 用聚合查询算条数和各层够不够；门槛从 `MIN_FINGERPRINT_SAMPLES` 等常量读；`EVAL_MIN_ASSISTANT_LINES` 与 `buildEvalCases` 共用。固定回法一层等 B2.2，未写入 `layers`。
- `ec91af6`：上传页挂 `MaterialReport`，不够的层写还差多少和怎么补。
- 临时库 `mirrai_v6_scratch`：`drizzle-kit push --force` 后 `material.test.ts` 3 通过。库随后 `dropdb`。`mirrai_live` 未碰。
- 闸门 `356 passed | 5 skipped (361)` 文件，`3129 passed | 21 skipped (3150)` 用例，`all six steps passed`。相对 B8.9（354/4 文件、3126/18 用例）：通过文件 +2、通过用例 +3；跳过文件 +1、跳过用例 +3，全部来自 `material.test.ts` 的 `skipIf`（偏差 77）。
- README「建议至少 100 条消息」后指向这张表，等 WP18。
- 未验证清单、待用户决定无新增。
- B8.10 标 ✅。WP4 可做条目全部完成。独立验收另开会话。
