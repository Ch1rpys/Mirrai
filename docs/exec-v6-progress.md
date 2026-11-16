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
| A2 | ⬜ |  |  |
| A3 | ⬜ |  |  |
| A4 | ⬜ |  |  |
| A5 | ⬜ |  |  |
| A6 | ⬜ |  |  |
| A7 | ⬜ |  |  |
| A8 | ⬜ |  |  |
| A9 | ⬜ |  |  |
| B1.1 | ⬜ |  |  |
| B1.2 | ⬜ |  |  |
| B1.3 | ⬜ |  |  |
| B1.4 | ⬜ |  |  |
| B1.5 | ⬜ |  |  |
| B1.6 | ⬜ |  |  |
| B1.7 | ⬜ |  |  |
| B1.8 | ⬜ |  |  |
| B1.9 | ⬜ |  |  |
| B1.10 | ⬜ |  |  |
| B2.1 | ⬜ |  |  |
| B2.2 | ⬜ |  |  |
| B2.3 | ⬜ |  |  |
| B2.4 | ⬜ |  |  |
| B2.5 | ⬜ |  |  |
| B2.6 | ⬜ |  |  |
| B2.7 | ⬜ |  |  |
| B2.8 | ⬜ |  |  |
| B2.9 | ⬜ |  |  |
| B3.1 | ⬜ |  |  |
| B3.2 | ⬜ |  |  |
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
| B8.1 | ⬜ |  |  |
| B8.2 | ⬜ |  |  |
| B8.3 | ⬜ |  |  |
| B8.4 | ⬜ |  |  |
| B8.5 | ⬜ |  |  |
| B8.6 | ⬜ |  |  |
| B8.7 | ⬜ |  |  |
| B8.8 | ⬜ |  |  |
| B8.9 | ⬜ |  |  |
| B8.10 | ⬜ |  |  |
| B9.1 | 🔒 |  |  |
| B9.2 | 🔒 |  |  |
| B9.3 | ⬜ |  |  |
| C1.1 | ⬜ |  |  |
| C1.2 | ⬜ |  |  |
| C1.3 | ⬜ |  |  |
| C1.4 | ⬜ |  |  |
| C1.5 | ⬜ |  |  |
| C1.6 | ⬜ |  |  |
| C1.7 | ⬜ |  |  |
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
| C10.1 | ⬜ |  |  |
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

## 未验证清单

| 条目 | 缺什么 | 该跑的命令 | 谁来跑 |
|---|---|---|---|

## 待用户决定

| 条目 | 问题 | 两个选项各自的后果 |
|---|---|---|

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
