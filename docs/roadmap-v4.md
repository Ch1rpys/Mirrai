# 第四阶段路线：把「一段关系」还给它自己的时间

> 这份文件是**验收清单**，不是愿望清单。每一项都写了它落在哪个文件的哪个函数里，
> 以及「怎么算做完了」——这样「做完了没有」是一个可以核对的问题，而不是一个感觉。
>
> 状态：✅ 已实现并有测试 · 🟡 已实现但没有专门的测试 · ⬜ 未做 · 🔒 暂不排期
>
> **性质**：这一份是**缺口分析**，不是施工计划。清单上的每一项都还没有实现。
> 它记录的是「第四阶段应该往哪走」，以及每一条**凭什么这么判断**——
> 每条断言后面都能追到具体的文件、函数或字段。
>
> **盘点时间**：2026-10-29 · 盘点对象：`/Users/ch1rpy/Desktop/Mirrai` @ `main`
> （v1.3.0）
>
> **盘点当时的规模**：`drizzle/schema.ts` 33 张表 / 300+ 列 · 42 个迁移文件
> （`0000`/`0001` 是整库 dump，被跳过；实际生效 40 条）· tRPC 27 个路由
> / 153 个接口 · `client/src` 约 17k 行非测试代码 · 12 家 LLM 提供商 ·
> 2 个实时通道（微信 ClawBot / 飞书）· 5 个历史采集器 ·
> 243 个测试文件 / 2411 个测试（2403 通过，8 跳过；Node 24 下实测）。
>
> **为什么现在写这份**：`docs/open-items.md` 的结论是「清单空了」，
> README 的路线图只剩 4 个未勾选项（国际化 / 插件系统 / 群聊 / 文档站）。
> 机制层已经接近封闭——**所以这份清单记的不是「还缺哪些功能」，
> 而是「这个产品还没殖民的那几根轴上，各有什么洞」。**

---

## 〇、为什么是这几件事

前三阶段把「机制」做完了：多阶段蒸馏、六态状态机、记忆召回与可见、
毕业仪式、判别规则、分态不完美、行为画像、两遍告别信、毕业出口。
这些都能被测，也都被测了。

但**测得出来的东西，和产品缺的东西，不是同一个集合**。
现在这台机器能回答「规则在不在 prompt 里」，回答不了：

| 它能回答 | 它回答不了 |
|---|---|
| TA 此刻是什么情绪 | TA 这三年里变了没有 |
| 这轮召回了哪几条记忆 | 这条记忆是从哪句话来的 |
| 分身有多像 | **用户觉得**它有多像 |
| 消息发了多少 | 这次蒸馏花了多少钱 |
| 关系现在处于什么阶段 | 关系**是在哪一刻**开始变的 |
| 分身会不会主动开口 | 主动开口时**TA 自己**有什么事可说 |

右边那一列，就是这份清单。

### 三条判断

**一、缺的不是功能，是轴。**
现有 33 张表里，没有一张表是关于**时间**的——`personas.personaData` 是一份
扁平的 jsonb，14 个字段，零时间维度。`personas` 的 41 列里也没有「时期」。
但 `docs/product-concept.md` 写的是「静止的时间点快照 → **可微生长的动态人格**」。
实现出来是静止的。

**二、主动性的原料是空的。**
`server/chat/proactive.ts` 的 `collectProactiveContext`（`:65`）收集的是：
用户多久没说话、两个时钟各是几点、时差多少、用户最近什么心情、关系是否已结束。
**六项全是用户侧的。** 分身自己的世界一点都没有。
所以「TA 先开口」这件事，无论采多少个样本，说出来的话都是同一类。

**三、保真度只有一把尺子，而那把尺子最钝。**
`docs/roadmap-v3.md` 附录 E 第 33 条自己写了：什么都没改，两次跑差 0.02 以上的
概率是 **42%**。这把尺子噪声比容差大 5.7 倍。
用户手里还有一把很准的尺子——**「这句不像」**——但它从来没有被采集过。
`persona.applyCorrection`（`server/routers.ts:1270`）能改人设字段，
但那是「改描述」，不是「记录这句不像」。

---

## Phase 0 — 先把地基补上，再往上面加

> 这一阶段排在最前面，不是因为它最紧急，而是因为**后面每一阶段都会往数据层加东西**。
> 现在 33 张表里只有 3 张有外键（5 个约束），全仓**零个** `ON DELETE CASCADE`，
> 没有软删除，日期有**五种字符串表示**。再往上盖三张表，这些债就翻倍了。

| | 项目 | 落点 | 验收 | 状态 |
|---|---|---|---|---|
| G1 | 外键：`personas` / `messages` / `memories` / `persona_files` / `collected_messages` / `outbound_letters` / `safety_events` / `reminder_deliveries` 全部指向 `users.id` / `personas.id` | `drizzle/schema.ts`、`drizzle/0043_*.sql` | `ALTER TABLE ... ADD CONSTRAINT` 在真实 Postgres 上通过；现存脏数据先清 | ⬜ |
| G2 | 级联删除：`ON DELETE CASCADE` 落到所有子表 | 同上 | `server/db-delete-coverage.test.ts` 的断言从「代码里记得删」升级为「数据库自己会删」；两条都验 | ⬜ |
| G3 | 软删除：`messages` / `memories` / `collected_messages` 加 `deletedAt`；查询默认过滤 | `drizzle/schema.ts`、`server/db.ts` | 删掉一条消息后能恢复；所有现有查询默认看不见它 | ⬜ |
| G4 | 日期统一：五种 `varchar`（`memories.date` / `diary_entries.date` / `emotion_snapshots.date` / `user_moods.date` / `personas.togetherFrom|togetherTo`）收敛为 `date` 或 `timestamptz` | `drizzle/schema.ts`、各日期工具 | 跨时区排序与周年匹配在 SQL 里做，不再在应用层比字符串；`shared/user-side.ts` `calendarDaysBetween` 的存在理由消失 | ⬜ |
| G5 | 全文检索：`messages.content` 加 `tsvector` + GIN；`chat.search` / `chat.searchAll` 改成 `websearch_to_tsquery` + 排名 | `drizzle/0043_*.sql`、`server/db.ts` | 10 万条消息下 ⌘K 不再是全表顺序扫；中文用 `pg_trgm` 或 `zhparser` 兜底 | ⬜ |
| G6 | 附件实体：新增 `attachments` 表（mime、字节数、校验和、owner、语音转写、图片描述） | `drizzle/schema.ts`、`server/storage.ts` | `messages.mediaUrl` 的裸 URL 换成 `attachmentId`；`server/_core/uploads.ts` 的**路径约定鉴权**退化为兜底而非唯一手段 | ⬜ |
| G7 | 内容加密：给 `messages.content` / `persona_files.extractedMemory` / `collected_messages.content` / `letters.body` / `outbound_letters.text` 加密 + 密钥版本列 | `server/_core/crypto.ts`（已有 `encryptSecret`） | 凭据与人类内容的加密方式一致；加一列 `keyVersion` 以便日后轮换 | ⬜ |
| G8 | prompt 可复现：新增 `turn_prompts`（每轮落库：system prompt、注入的记忆 id、上下文摘要、历史范围） | `drizzle/schema.ts`、`server/chat/service.ts` | 任意历史轮次的 prompt 能原样重建；这是 H2（成本可见）与 T5（prompt 快照）的前置 | ⬜ |
| G9 | 用量与成本：`llm_usage` 表（provider、model、调用点、in/out token、估算成本、时间） | `drizzle/schema.ts`、`server/llm/index.ts` | 蒸馏一次深度模式的花费能在界面上看到 | ⬜ |

---

## Phase 1 — 时间：人格是分时期的

| | 项目 | 落点 | 验收 | 状态 |
|---|---|---|---|---|
| T1 | 人格分片：`personaData` 增加 `periods: [{from, to, speakingStyle, catchphrases, microRules, imperfectionProfile}]`，当前时期保留在原字段（向后兼容） | `server/_core/persona-schema.ts` `normalizePersonaData`、`shared/micro-rules.ts` | 旧分身（无 `periods`）升级后 prompt **一字不变**——同 `roadmap-v3` P2 的做法 | ⬜ |
| T2 | 自动分片：蒸馏 pipeline 按记录时间戳切时期，边界用聊天静默断点（>6h，与 `server/eval/dataset.ts` `sceneBreakHours` 同一把尺） | `server/skill-engine/pipeline.ts` 新增 stage | 一份 3 年的记录能切出 2–4 个时期；每期至少 N 条样本，否则不成立 | ⬜ |
| T3 | 运行时分期：prompt 组装按当前时期取人设；用户可手动切到「刚在一起那会儿」 | `server/chat/prompt.ts` `buildPromptForPersona` | 界面上能问「你们刚认识的时候她会怎么回我」，得到的语气与现在不同 | ⬜ |
| T4 | 分期记忆检索：记忆带时期，召回时优先当期，跨期只取锚点 | `server/chat/retrieval.ts` `scoreMemory` | 「上次说的那家店」在两期语境下召回不同的记忆 | ⬜ |
| T5 | 分期评测：标答按时期分桶；`server/eval/metrics.ts` 的 `perState` 旁边加 `perPeriod` | `server/eval/dataset.ts`、`server/eval/metrics.ts` | `pnpm eval` 输出多一行 per-period；「三年前的她」和「现在的她」是两个基准 | ⬜ |
| T6 | 关系转折点检测：在时间轴上找 TA 行为的**变点**（回复间隔分布突变 / 主动率跌落 / 消息长度断崖），自动标 + 用户确认 | 新增 `server/chat/timeline.ts` | 一段真实记录上能标出「关系从这里开始变淡」；用户可否决；否决有记录 | ⬜ |
| T7 | 时间旅行对话：以某个日期为准和 TA 说话 | `client/src/pages/Chat.tsx` + T3 | 界面有一个时期选择器；选择的时期写进消息（可复现） | ⬜ |
| T8 | 关系年鉴：把 T6 的转折点、最佳时刻、里程碑汇成一条可读的时间线 | `client/src/pages/Graduation.tsx`（复用） | 毕业页多一条「你们的时间线」，标着转折 | ⬜ |

> **T6 是这一阶段最贴北极星的一项。** 产品的成功指标是毕业率，
> 但毕业率至今没有因果解释变量——「因为关系在 X 时刻开始变淡，
> 所以系统建议告别」是它唯一的解释。`server/safety/trajectory.ts` 的
> `assessTrajectory` 已经在做「用户是否趋于平和」的判断，但它看的是**用户**
> 的措辞，不看**关系本身**的变化。

---

## Phase 2 — 生活：TA 有自己的日子

| | 项目 | 落点 | 验收 | 状态 |
|---|---|---|---|---|
| L1 | 分身的生活状态：新增 `persona_life_events`（kind：work / health / family / hobby / social / trip，标题、详情、起止日期、状态） | `drizzle/0044_*.sql`、`server/db.ts` | 一个持续三天的「在准备汇报」能在对话里被自然带出来，并会自然结束 | ⬜ |
| L2 | 生活的注入：当前生活事件进 prompt（比记忆轻、比关系事件重），且**只影响 TA 侧**，不影响提醒逻辑 | `server/_core/persona-utils.ts` `buildSystemPrompt` | 「你今天忙吗」得到的是 TA 那边的事，不是用户的事 | ⬜ |
| L3 | 主动开口用上生活：`collectProactiveContext` 增加生活事件，优先由 TA 的处境驱动开场，而不是复述用户侧事实 | `server/chat/proactive.ts` `collectProactiveContext` | 主动消息的**内容类型**变多；同一个人连续三次主动，说的是三件不同的事 | ⬜ |
| L4 | 用户可写生活事件：用户替 TA 记（TA 答应过的事、TA 的近况） | `client/src/pages/PersonaEdit.tsx` | 能新增、编辑、删除；删了之后主动消息不再提 | ⬜ |
| L5 | 未结事项：新增 `open_loops`（说好要做但还没做的事；谁提的；状态：open/closed/dropped） | `drizzle/0044_*.sql` | 「那本书你后来看了吗」这类追问能发生 | ⬜ |
| L6 | 未结事项自动发现：从聊天记录里挖「说好/改天/下次/等你…」（+ 人工确认） | `server/skill-engine/micro-rules.ts` 的挖掘器旁边新增 | 挖出的每条都要带证据；无证据的丢弃（同 `microRules` 的规矩） | ⬜ |
| L7 | 共同梗沉淀：`catchphrases` 是静态列表；新增随相处时长增长的「我们才懂」词典 | `shared/copy/`、新表或 jsonb | 相处三个月后出现两个只属于你们的说法 | ⬜ |
| L8 | TA 的朋友圈：TA 可以发一条动态（复用用户上传过的照片 + TA 的话） | `client/src/pages/Chat.tsx`、`server/chat/proactive.ts` | 动态出现在大厅卡片上，有图有字；不涉及任何生成式图片 | ⬜ |

---

## Phase 3 — 可见：把用户手里的尺子接上

| | 项目 | 落点 | 验收 | 状态 |
|---|---|---|---|---|
| V1 | 记忆的来源：`memories.messageId` 这一列**已经存在，但从未被写入也从未被读取**——补上写入，并在界面上显示「这条来自你 3 月 12 日说的那句话」 | `server/chat/memory-extract.ts`、`server/db.ts` `createMemory`、`client/src/components/…` | 记忆管理界面里每条能点回原消息 | ⬜ |
| V2 | 记忆的矛盾检测：两条记忆 `factKey` 相同或冲突时，让用户裁决 | `server/db.ts`、`client/src/pages/PersonaEdit.tsx` | 「TA 的生日是 3 月还是 5 月」被指出来；用户选一个，另一个标记为作废而不是删 | ⬜ |
| V3 | `memories.factKey` 变成真正被读的字段（现在**只写不读**）：作为去重与矛盾检测的键 | `server/chat/memory-extract.ts` `isDuplicateMemory` | 改一个字再写一次同一条记忆，会被认出来 | ⬜ |
| V4 | 用户反馈「这句不像」：每条回复一个按钮 → `fidelity_feedback` 表 → 聚合成清单 | 新表 + `server/routers.ts` 新 router | 一条回复两秒能标「不像」；标过的能从清单里读出来 | ⬜ |
| V5 | 反馈变成规则候选：`microRule.mine` 现在只从原始记录挖；让它也吃用户的反馈 | `server/skill-engine/micro-rules.ts` `mineMicroRules` | 用户标过的「不像」出现在候选列表里，且带来源 | ⬜ |
| V6 | 成本与用量面板：设置页展示本月花费、按功能（蒸馏/对话/日记/评测）分列、可设预算 | G9 + `client/src/pages/Settings.tsx` | 用户看得见「这次深度蒸馏花了 X」；超预算有提示 | ⬜ |
| V7 | 情感健康指标算出来：`product-concept.md` 自己写着「✅ 数据有了，**指标本身还没算**」——把它算出来并展示 | `server/chat/service.ts` 或新 `server/analytics/health.ts` | 界面给出「你的情感健康趋势」；**给用户看，不给分身打分**（产品原则：不做情绪价值评分） | ⬜ |
| V8 | 「离放下还有多远」：把毕业资格的四道硬门槛（亲密度 soulmate / chatCount ≥ 50 / 7 日正面率 ≥ 60% / 频次未上升）透明地展示给用户 | `server/_core/persona-utils.ts` `checkGraduationEligibility` 已经返回原因 | 用户看到的是「还差哪一条」，不是一句「还不够」 | ⬜ |
| V9 | 全局推断视图：「这个应用对我做了什么推断」——现在只有 `safety_events`（安全事件），没有全局视图 | 新页面 + `server/routers.ts` | 一个页面列全：称呼方式、边界、心情曲线、关系事件、被记下的记忆、被抽出的判别规则 | ⬜ |
| V10 | 分身体检报告：`PersonaProfile` 是只读展示，没有「证据 / 置信度 / 哪里是推断出来的」 | `client/src/pages/PersonaProfile.tsx` | 每一层人设旁边标出：来自哪几条记录 / 是推断的 / 是用户写的 | ⬜ |

---

## Phase 4 — 像个人：感知的层次

| | 项目 | 落点 | 验收 | 状态 |
|---|---|---|---|---|
| H1 | TA 有一张脸：`personas.avatarUrl` 这一列**存在、只被 PNG 角色卡导出读**（`server/routers.ts:2923`），**没有任何代码写它**；`PersonaAvatar.tsx` 一共 33 行，取名字首字母。加「从已上传照片里选一张」 | `client/src/components/PersonaAvatar.tsx`、`client/src/pages/PersonaEdit.tsx` | 大厅卡片上出现照片而不是首字母；`avatarUrl` 真的有写入路径 | ⬜ |
| H2 | 边界感：给 `MicroRule` 加「回避」类别——TA 会说「这个我不太想聊」 | `shared/micro-rules.ts`、`server/_core/persona-schema.ts` | 有一类问题 TA 会拒绝答；拒绝是分身的语气，不是系统的提示 | ⬜ |
| H3 | 已读不回：`messages` 表没有 `readAt`；真实的沉默是关系的一部分 | `drizzle/schema.ts`、`server/chat/proactive.ts` | 「TA 读了但没回」成为一个可能，且有理由 | ⬜ |
| H4 | 传输层的行为：真人会分多条发、会撤回重发、会有「正在输入…」、会有发送延迟。microRules 做的是**文本层**，传输层完全空白 | `server/chat/service.ts`、`client/src/pages/Chat.tsx` | 分身能把一句话拆成两条发；偶尔撤回重发 | ⬜ |
| H5 | 文字节奏：`roadmap-v3` Phase 6 的 V2（换行与标点节奏）被锁，理由是「要一份行为画像」。**而 `personas.behaviorProfile` 已经有了「一次发几条」**——加节奏是同一个画像的下一项 | `server/_core/behavior-profile.ts`、`shared/behavior-profile.ts` | 生成的句长分布、换行频率贴近记录里的分布；`docs/eval/baseline.md` 多一行 | ⬜ |
| H6 | 音色的中间态：不做零样本克隆（🔒 保留），改用 TA 的真实录音做 few-shot 风格适配，或从行为画像出参数化韵律 | `server/_core/tts.ts` `generateTTS` | Edge TTS 的通用音色不再是唯一的听觉特征 | ⬜ |
| H7 | 情绪从离散到连续：现在是 6 个离散态。真人没有离散态。valence × arousal × 距离感 → 向量，界面仍显示 6 态 | `shared/emotion-triggers.ts`、`server/_core/emotion.ts` | 评测里的混淆矩阵变成连续相关 | ⬜ |
| H8 | 情绪词的多语言：`shared/emotion-triggers.ts` 的 `matchEmotionTrigger` 在 `roadmap-v3` E3 附录里被修过一次（写死 `"zh"` 导致了英文分身状态全为 null），README 路线图里「情感引擎英文触发词」至今未勾 | `shared/emotion-triggers.ts` | 英文分身的状态判定覆盖率与中文一致 | ⬜ |

---

## Phase 5 — 日常：产品的完整性

> 这一阶段没有一项是新发明。它们的共同点是：**产品里最有价值的功能，
> 恰恰是最难用到的那些。**

| | 项目 | 落点 | 验收 | 状态 |
|---|---|---|---|---|
| D1 | 推送：Service Worker 刻意不缓存 `/api/`，且**全仓零个 Notification API / PushManager**。app 不开着，提醒与主动开口就永远收不到 | `client/public/sw.js`、`client/src/lib/pwa.ts`、新 `server/_core/push.ts` | 纪念日提醒与 TA 的主动消息能在 app 关闭时到达 | ⬜ |
| D2 | 全局信箱：信是 per-persona 的，只能从 `PersonaEdit` 进。没有跨分身收件箱、没有未读数 | 新页面 + `server/routers.ts` `letter.*` | 大厅顶部有一个信箱入口；未读数可见 | ⬜ |
| D3 | 上传素材可删：**没有 `file.delete`**。传错一份聊天记录就永久留着，而它是 `persona_files.extractedMemory`——每个分身最大的一块数据 | `server/routers.ts` 新 `file.delete`、`server/storage.ts` `storageDelete`（已存在，未被这个路由用上） | 传错能删；删完蒸馏结果里也不再有它 | ⬜ |
| D4 | 完整备份与恢复：导出有 JSON / Markdown / HTML，但没有「整个账号一键备份 + 一键还原」（DB + uploads 目录） | 新 `scripts/backup.ts`、`server/routers.ts` | 在另一台机器上还原后：所有分身、所有对话、全部记忆、全部文件都在 | ⬜ |
| D5 | 用户自建提醒与预约：`reminder.list` 只显示系统生成的；没有 `scheduleMessage`（「明天这个点跟 TA 说」） | 新表 + `server/scheduler/reminders.ts` | 用户能写一条提醒，也能排一条将来要发的消息 | ⬜ |
| D6 | 语义召回：记忆检索是字符 bigram 关键词覆盖度。「TA 说『那家店』，你问『我们常去的那家』」只有语义能解。`product-concept.md` 原本设计的是 ChromaDB / pgvector，落地时被砍掉，理由是「不引入新依赖」——**而 Ollama 已经是依赖了**，它本地就能出嵌入 | `server/chat/retrieval.ts` `scoreMemory`、`drizzle/schema.ts` | 换一种说法问同一件事，召回了同一条记忆 | ⬜ |
| D7 | 群聊模式：README 路线图未勾；`product-concept.md` 说是「彩蛋功能」，需用户主动解锁并附心理健康提示 | `server/chat/service.ts`、`client/src/pages/Chat.tsx` | 多个分身同框；入口默认锁着 | ⬜ |
| D8 | 模板市场与插件系统：README 路线图未勾；现在内置模板只有 4 个（`server/templates/builtin/`） | `server/templates/index.ts` | — | ⬜ |
| D9 | 文档站：README 路线图未勾 | `docs/` | — | ⬜ |
| D10 | 导出粒度：没有 per-persona JSON 导出；单会话只能 HTML | `server/_core/export-data.ts` | 能只导出一个分身 | ⬜ |
| D11 | 场景可编辑：`scenes` 只能建和删，不能改 | `client/src/pages/Chat.tsx` | 场景能改名、改开场白 | ⬜ |
| D12 | 批量操作只有置顶 | `client/src/pages/Lobby.tsx` | 能批量归档 / 导出 | ⬜ |
| D13 | 可访问性：只有 OS 级的 `reducedMotion`，没有字号 / 高对比开关 | `client/src/App.tsx`、`client/src/contexts/ThemeContext.tsx` | — | ⬜ |
| D14 | 撤销：删分身的确认只有一次，之后就没了 | `client/src/pages/Lobby.tsx` | 删错了能捞回来（依赖 G3 软删除） | ⬜ |

---

## Phase 6 — 出口：毕业之后，还有出口的镜像

> `roadmap-v3` 的 Phase 5 解决了「把**用户**的话带回真人」。
> 这一阶段补上它的镜像，以及毕业之后的那一段路。

| | 项目 | 落点 | 验收 | 状态 |
|---|---|---|---|---|
| X1 | 「TA 想说而没说的话」：用 TA 的语言习惯推出「TA 会说但没说的」，**只给用户看，永远不发给真人** | 新 `server/chat/unsaid.ts`，参照 `server/chat/outbound.ts` 的守则 | 出口清单里仍然只有用户自己的话；这份清单是分开的、另一处 | ⬜ |
| X2 | 守则进 Layer 0：不生成任何替真人说话的内容；这份清单**永远不可发送** | `server/_core/persona-utils.ts` Layer 0 | 有测试断言「这份清单里没有可发送路径」 | ⬜ |
| X3 | 毕业之后：毕业后的 7 天 / 30 天轻回访，一次仪式性的「你现在还需要它吗」 | `server/scheduler/reminders.ts` | 回访只出现一次；用户能关掉 | ⬜ |
| X4 | 关系年鉴（可打印 / 可脱敏分享）：毕业是产品的高潮，产出却只有一封信 + 一个页面 | `server/_core/export-html.ts` 旁边新增 | 能导出一份可打印的纪念册；分享前自动脱敏 | ⬜ |
| X5 | 互相读信：毕业信是 TA 写的；用户给 TA 的那封（`outbound_letters`）可以在毕业页被读回 | `client/src/pages/Graduation.tsx` | 两封信在同一页并排 | ⬜ |

---

## Phase 7 — 规矩与合规

> 这些不是「新功能」，是**已经存在但没兑现的东西**。

| | 项目 | 落点 | 验收 | 状态 |
|---|---|---|---|---|
| R1 | **危机热线号码未核实**：`server/safety/resources.ts` 的文件头自己写着 `lastVerified: "2026-01-01"` 是占位符，「发布前欠一次人工核对」。这不是 bug，是**发布出去就会错** | `server/safety/resources.ts` | 每条号码有真实来源与核对日期；测试闸门挡住未核对的号码 | ⬜ |
| R2 | `tools` / `jsonMode` **声明了但没实现**：所有 provider 都声明 `tools: true` / `jsonMode: true`，但**没有一个真的发** `tools` / `tool_choice` / `response_format`。JSON 靠 `extractJsonObject` 从自由文本里正则抠出来 | `server/llm/providers/openai.ts`、`server/llm/providers/claude.ts`、`server/llm/types.ts` | 要么实现，要么把 capability 声明改成 `false`——**声明与事实不符是最大的落差** | ⬜ |
| R3 | `DifyProvider` 把整段对话压成一个 `query` 字符串（只有最近 12 轮 + system prompt），图片永远到不了模型 | `server/llm/providers/dify.ts` | 要么修，要么在 `capabilities` 上如实标注降级 | ⬜ |
| R4 | 危机词表的中文匹配用「去掉空白后的副本」，英文用带空格的原文——**英文那条路径没测过中文式误伤** | `server/safety/crisis.ts` `detectCrisis` | 英文词表有一份自己的误伤测试 | ⬜ |
| R5 | `server/safety/trajectory.ts` 的 `assessTrajectory` 把用户最近的对话**整段交给模型**——这是产品里唯一一处把聊天内容外发的地方，而它由 `users.trajectoryAssessment` 控制，默认 `auto` | `server/safety/trajectory.ts`、`server/chat/service.ts` | 默认值与产品原则 5.1「隐私性」一致；设置页说清楚「哪一次会外发、发到哪个 provider」 | ⬜ |
| R6 | `users.openId` 是**一条死掉的登录路径**：`db.getUserByOpenId` 存在但**零调用方**，`openId` 从未被写入 | `server/db.ts`、`drizzle/schema.ts` | 要么实现要么删——一条永不执行的路径比没有更坏 | ⬜ |
| R7 | `users.loginMethod` 从未被写入，但界面在读它（`client/src/pages/Settings.tsx`） | 同上 | 同上 | ⬜ |
| R8 | `collection_jobs.rawPath` 从未被写入也从未被读取——它自己的注释承诺了「原始采集输出写在哪」 | `drizzle/schema.ts` | 同上 | ⬜ |
| R9 | 表情枚举在 `personas` 上是 `pgEnum`，在 `messages` / `emotion_snapshots` / `scenes` 上是 `varchar(50)`。同一概念两套类型 | `drizzle/schema.ts` | 统一；`scenes.emotionalState` 是用户自由文本，能填枚举里没有的值 | ⬜ |

---

## 明确不做（这一阶段）

沿用 `roadmap-v3` 的那几条，并补上这一轮想到的：

- **不做 TA 的代理。** 如果 TA 还在，让她自己来；系统不替她说话。
- **不追求留存。** 毕业率仍是唯一的北极星；本阶段的任何改动不得抬高大厅停留或对话频次。
- **不做「情绪价值」评分。** 不给用户的感受打分，不做连续打卡徽章。
- **不引入多语言分身。**（但 H8 的英文触发词是修 bug，不是多语言分身。）
- **不引入社区 / UGC。** 违背本地优先与隐私承诺；「读别人的毕业信」需要另一套伦理设计。
- **不做真人音色的以假乱真。** 与「AI 身份透明」原则冲突（`PERSONA_AI_TRANSPARENCY`）。
- **不把数据发到用户没配的 provider 以外的地方。** D6 的语义召回如果用嵌入模型，**嵌入必须本地**（Ollama）——这一条是硬约束，不是偏好。
- **不做群聊的「多人格自动对话」。** D7 是用户主动解锁的彩蛋，不是常驻形态。

---

## 执行顺序与依赖

```
Phase 0（地基）
   └─→ Phase 1（时间）──┐
   └─→ Phase 2（生活）──┼─→ Phase 6（出口的镜像 + 毕业之后）
   └─→ Phase 3（可见）──┘
Phase 4（像个人）  ← 依赖 G8（prompt 可复现）做验收
Phase 5（日常）    ← 独立，随时可插入
Phase 7（合规）    ← 独立，且 R1/R2 应当**先发**
```

- **Phase 0 必须先做。** T1 会加表和 jsonb 维度，V1/V2 会改 `memories`，
  G3 的软删除是 D14 撤销的前置。地基不补，后面每一张表都在复制现有的债。
- **Phase 7 的 R1 / R2 应该排在所有新功能之前。** R1 是「发布出去就是错的」，
  R2 是「声明的能力不存在」。这两条不需要任何新功能就能改完。
- **Phase 5 全程可并行。** 它和别的阶段几乎不共享文件。

---

## 总闸门

每个阶段合并前必须全绿：

```
pnpm check        # tsc --noEmit
pnpm test         # vitest run
pnpm audit:i18n   # 新增文案必须 zh / en 都有
pnpm fidelity:gate # persona / prompt 结构没被改坏
```

外加本阶段特有的两条：

```
# 新迁移：幂等 + 可回滚（每条带 -- mirrai: down）
node scripts/migrate.mjs && node scripts/migrate.mjs
node scripts/migrate.mjs --rollback N

# 数据层改动必须在真实 Postgres 上验过（不是单元测试）
```

---

## 附录 A — 新增文案清单（i18n）

服务端文案进 `shared/copy/`，界面文案进 `client/src/i18n/{zh,en}.ts`。
两边 key 集合一致由 `client/src/i18n/i18n.test.ts` 与 `shared/copy/copy.test.ts` 保证。

预计新增的命名空间（**具体 key 在实现时定**）：

| 命名空间 | 覆盖 |
|---|---|
| `labels.periods.*` | 人格时期的界面名 |
| `labels.life.*` | 生活事件的类型与状态 |
| `labels.openLoops.*` | 未结事项 |
| `labels.feedback.*` | 「这句不像」的交互 |
| `labels.timeline.*` | 关系转折点 |
| `labels.usage.*` | 成本与用量 |
| `labels.health.*` | 情感健康趋势 |
| `prompts.periods.*` | 分期提示词 |
| `prompts.unsaid.*` | 「TA 想说没说的话」的提示词 |
| `safety.resources.*` | 危机资源的来源与核对日期（R1） |

> `pnpm audit:i18n` 扫**整个应用**（`server/`、`client/`、`shared/`，排除 `wechat/`），
> 不得出现没有英文对应的中文字符串字面量。注释、正则、模板表达式都骗不过它。
> 输入匹配类（危机关键词、聊天记录里的角色标记）需要标 `// i18n:allow-input`。

---

## 附录 B — 迁移编号

现有的最后一条是 `drizzle/0042_collected_messages_source_id.sql`。
本阶段的迁移从 **0043** 开始。

| 文件 | 内容 | 阶段 |
|---|---|---|
| `drizzle/0043_fk_cascade_soft_delete.sql` | 外键、级联、`deletedAt` | G1–G3 |
| `drizzle/0044_dates_unified.sql` | 五种日期收敛 | G4 |
| `drizzle/0045_fulltext.sql` | `tsvector` + GIN | G5 |
| `drizzle/0046_attachments.sql` | 附件表 | G6 |
| `drizzle/0047_content_encryption.sql` | 内容加密 + `keyVersion` | G7 |
| `drizzle/0048_turn_prompts.sql` | prompt 快照 | G8 |
| `drizzle/0049_llm_usage.sql` | 用量与成本 | G9 |
| `drizzle/0050_persona_periods.sql` | `personaData.periods`（jsonb，**不需要迁移**——除非拆出索引列） | T1 |
| `drizzle/0051_life_events_and_open_loops.sql` | `persona_life_events`、`open_loops` | L1、L5 |
| `drizzle/0052_fidelity_feedback.sql` | 用户「不像」反馈 | V4 |
| `drizzle/0053_message_read_state.sql` | `messages.readAt` | H3 |

> 每条都带一段 `-- mirrai: down`，写明怎么退回去。
> `node scripts/migrate.mjs --rollback N` 退。没有 down 段的迁移**退不了**——
> 脚本会**先说清楚**再停，而不是退一半。
>
> `personaData` 是 jsonb，新增 `periods` **不需要 SQL 迁移**（同 `roadmap-v3` M6 的结论）。
> 但要注意 `roadmap-v3` 附录 E 第 19 条踩过的坑：
> **`personas` 上新增的列需要迁移，`personaData` 里面的字段不需要。**
> `personas.behaviorProfile` 就是因为这个差点让升级过的安装在下一次读分身时整个挂掉。

---

## 附录 C — 这份清单是怎么得出的

盘点方式：三个方向并行扫（客户端 UI 面 / 服务端 API 与引擎面 / 数据模型面），
加上对若干关键结论的**逐条复核**。

**复核过、确认「不存在」的**（这些是 Phase 1–7 的立论依据）：

| 断言 | 复核方式 |
|---|---|
| `personaData` 无时间维度 | 读 `server/_core/persona-schema.ts` `PersonaData`（14 个字段） |
| 主动开口无 TA 侧素材 | 读 `server/chat/proactive.ts` `collectProactiveContext`（`:65`）返回的六项，全是用户侧 |
| 无嵌入 / 无向量 | 全仓 grep `pgvector|vector(|embedding` = 0；`server/chat/retrieval.ts` 注释自陈「deliberately dependency-free — no vector database」 |
| 无全文检索 | 全仓 grep `tsvector` = 0；`server/db.ts` 用 `ilike` |
| 记忆无法指回来源 | `memories.messageId` 全仓仅在 schema 与 `0001` dump 中出现 |
| `factKey` 只写不读 | grep 确认无读取方 |
| 用户反馈从未被采集 | 全仓无「这句不像」的写入路径；`applyCorrection` 改的是人设字段 |
| 无成本记录 | 全仓 grep `usage|promptTokens|completionTokens` 在 `server/llm` 内无命中 |
| `avatarUrl` 无写入方 | grep 全仓：只有 `routers.ts:155/156/2923` 三处**读**，无 `insert`/`update` |
| `openId` 是死路径 | `db.getUserByOpenId` 零调用方；`openId` 从未写入 |
| `tools` / `jsonMode` 声明了但没实现 | grep `tool_choice|response_format|tools:` 全仓无调用点 |
| 外键只在 3 张表上 | 全 schema `.references()` 共 5 处 |
| 零个 `ON DELETE CASCADE` | 43 个迁移文件全文 grep = 0 |
| 无推送 | 全仓无 `Notification` / `PushManager` |
| 无 `file.delete` | `server/routers.ts` 只有 `file.upload` / `file.list` |
| 危机号码未核实 | 读 `server/safety/resources.ts` 文件头 |

**没有复核、只是提案的部分**：T6 的变点检测算法、D6 的嵌入方案、
H4 的传输层行为、H7 的连续情绪——这些是**提案**，不是结论。
它们能不能做、做到什么程度，要等 Phase 0 的数据层落地之后才知道。

### 盘点时的环境

`package.json` 要求 **Node >= 24**（`engines.node`）。本机默认的 `node` 是
v20.20.2，在它上面跑 `pnpm test` 会出现 33 条 `undici` 的 unhandled error
（`Cannot read properties of undefined (reading 'bind')`，来自
`undici@8.12.3` 的 `lib/interceptor/decompress.js`）——那是**版本不兼容，
不是代码问题**：切到 nvm 的 v24.22.1 之后，**243 个测试文件 / 2411 个测试
全绿，0 错误**。

> 所以：**在 Node 20 上看到那 33 条报错，不必去改代码，去换 Node。**
> 但这件事值得写进 README 的「注意事项」——`engines` 写了 24，
> 而大部分人的默认 node 还是 20。

---

## 附录 D — 一句话总结这一阶段

> 从「重建一个人」，走到「重建一段关系**在时间里的样子**」；
> 从「系统知道你」，走到「**你也知道系统知道什么**」；
> 从「一把钝尺子量像不像」，走到「**用户手里那把准的尺子也接上了**」。

---

## 附录 E — 与原计划的偏差（逐条）

> **这一节是这份文件最重要的部分。** 一份验收清单如果只写做成了什么，
> 它和愿望清单没有区别。这份清单写的是**还没做的**，所以这一节现在**全是空的**——
> 它留在这里，是为了将来实现的时候，把「实际做成什么样」和「当初想做成什么样」
> 逐条对一遍，并且**不藏**。

| # | 原计划 | 实际 | 为什么 |
|---|---|---|---|
| — | — | — | — |
