/**
 * The words for the sixth-stage work, starting with the record table.
 */
import type { CopyTable } from "./index";

export const V6 = {
  "errors.recordsLimit": {
    zh: "这个分身已经有 {{current}} 条记录，再写入 {{incoming}} 条会超过上限 {{max}}。",
    en: "This persona already has {{current}} records; writing {{incoming}} more would go past the limit of {{max}}.",
  },
  "errors.rerankTooFew": {
    zh: "记录不够，重排选不出来。至少要有 40 条 {{name}} 的话。",
    en: "There are not enough lines to rerank. {{name}} needs at least 40 of their own.",
  },
  "errors.importFailed": {
    zh: "这份文件没有整理成记录。",
    en: "This file was not turned into records.",
  },
  "errors.importArchiveBroken": {
    zh: "这个压缩包打不开。",
    en: "That zip archive could not be opened.",
  },
  "errors.importArchiveTooMany": {
    zh: "这个压缩包里的文件太多，没有解开。",
    en: "That zip archive has too many files, so it was not unpacked.",
  },
  "errors.importArchiveTooLarge": {
    zh: "这个压缩包解开之后太大，没有留下文件。",
    en: "That zip archive would unpack to more than the size limit, so nothing was kept.",
  },
  "errors.importPersonaNotFound": {
    zh: "这个分身不存在，或者不属于你。",
    en: "That persona does not exist, or it is not yours.",
  },
  "errors.importTooManyRequests": {
    zh: "传得太快了——等一下再试。",
    en: "You are uploading too fast — wait a moment and try again.",
  },
  "errors.importUploadEmpty": {
    zh: "这份文件是空的。",
    en: "That file is empty.",
  },
  "errors.importCancelled": {
    zh: "这次导入已经取消。",
    en: "That import was cancelled.",
  },
  "errors.importRolesRequired": {
    zh: "先指出哪一边是你、哪一边是 TA。",
    en: "Say which side is you and which side is them first.",
  },
  "import.format.genericLine": {
    zh: "一行一条的聊天记录",
    en: "One message per line",
  },
  "import.format.wechatTxt2Line": {
    zh: "微信 TXT（时间与昵称一行）",
    en: "WeChat TXT (time and name on one line)",
  },
  "import.format.wechatTxtParen": {
    zh: "微信 TXT（昵称与括号时间）",
    en: "WeChat TXT (name and parenthesised time)",
  },
  "import.format.wechatCsv": {
    zh: "微信 CSV",
    en: "WeChat CSV",
  },
  "import.format.wechatJson": {
    zh: "微信 JSON",
    en: "WeChat JSON",
  },
  "import.format.qqTxt": {
    zh: "QQ 消息管理器的 TXT",
    en: "QQ message-manager TXT",
  },
  "import.format.qqMht": {
    zh: "QQ 消息管理器的 MHT",
    en: "QQ message-manager MHT",
  },
  "import.format.telegramJson": {
    zh: "Telegram 的 JSON 导出",
    en: "Telegram JSON export",
  },
  "import.format.whatsappTxt": {
    zh: "WhatsApp 导出的 TXT",
    en: "WhatsApp exported TXT",
  },
  "import.format.lineTxt": {
    zh: "LINE 导出的 TXT",
    en: "LINE exported TXT",
  },
  "import.format.kakaoTxt": {
    zh: "KakaoTalk 导出的记录",
    en: "KakaoTalk exported chat",
  },
  "import.format.metaJson": {
    zh: "Instagram / Messenger 的 JSON",
    en: "Instagram / Messenger JSON",
  },
  "import.format.discordJson": {
    zh: "Discord 导出的 JSON",
    en: "Discord exported JSON",
  },
  "import.format.smsXml": {
    zh: "短信备份的 XML",
    en: "SMS Backup XML",
  },
  "import.format.imessageDb": {
    zh: "Mac 信息的 chat.db",
    en: "Mac Messages chat.db",
  },
  "import.format.columnMap": {
    zh: "按列对应的表格",
    en: "Table by column map",
  },
  "record.duration.hour": {
    zh: "{{n}} 小时",
    en: "{{n}}h",
  },
  "record.duration.minute": {
    zh: "{{n}} 分",
    en: "{{n}} min",
  },
  "record.duration.second": {
    zh: "{{n}} 秒",
    en: "{{n}}s",
  },
  "record.kind.sticker": {
    zh: "［表情：{{label}}］",
    en: "[sticker: {{label}}]",
  },
  "record.kind.stickerBare": {
    zh: "［表情］",
    en: "[sticker]",
  },
  "record.kind.image": {
    zh: "［图片］",
    en: "[image]",
  },
  "record.kind.voice": {
    zh: "［语音 {{duration}}］",
    en: "[voice {{duration}}]",
  },
  "record.kind.voiceBare": {
    zh: "［语音］",
    en: "[voice]",
  },
  "record.kind.video": {
    zh: "［视频 {{duration}}］",
    en: "[video {{duration}}]",
  },
  "record.kind.videoBare": {
    zh: "［视频］",
    en: "[video]",
  },
  "record.kind.location": {
    zh: "［位置：{{name}}］",
    en: "[location: {{name}}]",
  },
  "record.kind.locationBare": {
    zh: "［位置］",
    en: "[location]",
  },
  "record.kind.link": {
    zh: "［链接：{{title}}］",
    en: "[link: {{title}}]",
  },
  "record.kind.linkBare": {
    zh: "［链接］",
    en: "[link]",
  },
  "record.kind.music": {
    zh: "［音乐：{{title}}］",
    en: "[music: {{title}}]",
  },
  "record.kind.musicBare": {
    zh: "［音乐］",
    en: "[music]",
  },
  "record.kind.transfer": {
    zh: "［转账：{{amount}}］",
    en: "[transfer: {{amount}}]",
  },
  "record.kind.transferBare": {
    zh: "［转账］",
    en: "[transfer]",
  },
  "record.kind.redpacket": {
    zh: "［红包］",
    en: "[red packet]",
  },
  "record.kind.pat": {
    zh: "［拍了拍］",
    en: "[pat]",
  },
  "record.kind.recall": {
    zh: "［撤回］",
    en: "[recalled]",
  },
  "record.kind.callVoice": {
    zh: "［语音通话 {{duration}}］",
    en: "[voice call {{duration}}]",
  },
  "record.kind.callVideo": {
    zh: "［视频通话 {{duration}}］",
    en: "[video call {{duration}}]",
  },
  "record.kind.file": {
    zh: "［文件：{{name}}］",
    en: "[file: {{name}}]",
  },
  "record.kind.fileBare": {
    zh: "［文件］",
    en: "[file]",
  },
  "distill.speakerMe": {
    zh: "我",
    en: "me",
  },
  "prompts.distill.observationCard": {
    zh: [
      "你在读 {{name}} 的一段聊天记录。只根据这一段里看得到的内容，写出最多 8 条观察。",
      "只写这一段里发生的事，不要概括整个人，不要用这段之外的记忆。",
      "每条观察必须引用这段里的行号（# 后面的数字）。引用必须真实存在。",
      "expression 和 habit 两类必须至少引用一行 {{name}} 自己说的话。",
      "claim 一句话，不超过 60 字。没有可写的就返回空数组。",
      "只输出 JSON，不要解释：",
      '{ "observations": [{ "dimension": "expression|trigger|conflict|care|memory|habit", "claim": "", "quotes": [123] }] }',
    ].join("\n"),
    en: [
      "You are reading one stretch of {{name}}'s chat. Write at most 8 observations from only what this stretch shows.",
      "Stay inside this stretch. Do not summarise the whole person. Do not use anything from outside it.",
      "Every observation must cite line numbers from this stretch (the number after #). The ids must be real.",
      "The expression and habit dimensions must cite at least one line {{name}} said.",
      "Each claim is one sentence, at most 60 characters. If there is nothing to write, return an empty array.",
      "Return JSON only, with no explanation:",
      '{ "observations": [{ "dimension": "expression|trigger|conflict|care|memory|habit", "claim": "", "quotes": [123] }] }',
    ].join("\n"),
  },
  "distill.readingChunk": {
    zh: "正在读第 {{done}} / {{total}} 段",
    en: "Reading block {{done}} / {{total}}",
  },
  "distill.reusedChunks": {
    zh: "{{reused}} 段读过了，这次读新的 {{fresh}} 段。",
    en: "{{reused}} block(s) were already read; this run reads {{fresh}} new block(s).",
  },
  "distill.tooManyChunkFailures": {
    zh: "有 {{failed}} / {{total}} 段读不出来，超过了三成，这一次没有继续。",
    en: "{{failed}} of {{total}} blocks could not be read — more than a third — so this run stopped.",
  },
  "prompts.distill.mergeCards": {
    zh: [
      "下面是对 {{name}} 同一段时期的观察卡。每张卡带着原话片段和日期。",
      "把它们归并成四段，沿用分析稿的结构：Expression DNA、Emotional Triggers、Conflict Pattern、Memory Signature。",
      "只根据这些卡片写。不要发明卡片里没有的事。不要复述整段聊天。",
      "证据和推断分开。材料不够的地方标（source material insufficient）。",
      "用用户的语言写。只输出这四段正文。",
    ].join("\n"),
    en: [
      "These are observation cards for one stretch of {{name}}'s life. Each card carries a quoted snippet and a date.",
      "Merge them into four sections, in the analyser layout: Expression DNA, Emotional Triggers, Conflict Pattern, Memory Signature.",
      "Write only from these cards. Do not invent what is not on them. Do not retell the chat.",
      "Keep evidence apart from inference. Mark thin places as (source material insufficient).",
      "Write in the user's language. Return only the four sections.",
    ].join("\n"),
  },
  "distill.builderNowPeriod": {
    zh: "最近一段是这个人现在的样子，以它为准；更早的是背景。",
    en: "The most recent stretch is how this person is now — treat it as current. Earlier stretches are background.",
  },
  "distill.periodNow": {
    zh: "{{from}} – {{to}}（现在）",
    en: "{{from}} – {{to}} (now)",
  },
  "distill.periodPast": {
    zh: "{{from}} 至 {{to}}",
    en: "{{from}} to {{to}}",
  },
  "errors.tooManyDistillCalls": {
    zh: "这次预估要调用 {{calls}} 次，超过了上限 {{max}}。换一个更轻的模式。",
    en: "This run would make {{calls}} calls, over the ceiling of {{max}}. Pick a lighter mode.",
  },
  "errors.extraBodyTooLarge": {
    zh: "额外请求参数超过了 2 KB。",
    en: "The extra request body is larger than 2 KB.",
  },
  "errors.extraBodyForbidden": {
    zh: "额外请求参数不能含 model、messages、stream、tools。",
    en: "The extra request body cannot include model, messages, stream, or tools.",
  },
  "errors.extraBodyInvalid": {
    zh: "额外请求参数必须是一个 JSON 对象。",
    en: "The extra request body has to be a JSON object.",
  },
  "prompts.distill.factCard": {
    zh: [
      "你在读 {{name}} 的一段聊天记录。只根据这一段，抽出事实、人物和态度。",
      "每条必须引用这段里真实存在的行号（# 后面的数字）。引用必须真实存在。",
      "date 只填 YYYY-MM-DD 或 MM-DD，不确定就填 null。",
      "只写这段里看得到的，不要概括整个人。没有可写的就返回空数组。",
      "只输出 JSON，不要解释：",
      '{ "facts": [{ "title": "", "description": "", "category": "anchor|milestone|anniversary|memory", "subject": "them|me", "date": "YYYY-MM-DD 或 MM-DD 或 null", "quote": 123 }], "people": [{ "name": "", "relation": "", "side": "them|me|both", "quote": 123 }], "stances": [{ "topic": "", "polarity": "like|dislike|fear|care|opinion", "statement": "", "quote": 123 }] }',
    ].join("\n"),
    en: [
      "You are reading one stretch of {{name}}'s chat. Pull facts, people and stances from only this stretch.",
      "Every item must cite a line number from this stretch (the number after #). The ids must be real.",
      "Dates are YYYY-MM-DD or MM-DD, or null when you are not sure.",
      "Stay inside this stretch. Do not summarise the whole person. If there is nothing to write, return empty arrays.",
      "Return JSON only, with no explanation:",
      '{ "facts": [{ "title": "", "description": "", "category": "anchor|milestone|anniversary|memory", "subject": "them|me", "date": "YYYY-MM-DD or MM-DD or null", "quote": 123 }], "people": [{ "name": "", "relation": "", "side": "them|me|both", "quote": 123 }], "stances": [{ "topic": "", "polarity": "like|dislike|fear|care|opinion", "statement": "", "quote": 123 }] }',
    ].join("\n"),
  },
  "distill.readingFacts": {
    zh: "正在抽第 {{done}} / {{total}} 段里的事实",
    en: "Reading facts in block {{done}} / {{total}}",
  },
  "distill.factsTruncated": {
    zh: "事实超过一千条，只留下了更重要、更近的 {{kept}} 条。",
    en: "There were more than a thousand facts; only the {{kept}} more important, more recent ones were kept.",
  },
  "prompt.userAct.ask": { zh: "在问一件事", en: "asking something" },
  "prompt.userAct.complain": { zh: "在抱怨、发火", en: "complaining or angry" },
  "prompt.userAct.other": { zh: "上面都不是", en: "none of the above" },
  "prompts.distill.labelEmotions": {
    zh: [
      "你在给一段聊天场景标分身当时的情绪。只看分身的语气，不要根据用户说了什么来判。",
      "state 必须是这些之一，含义与情感分类器相同：",
      "warm: 温柔、放松、亲近、有回应感",
      "playful: 俏皮、开玩笑、活泼、撒娇",
      "nostalgic: 怀念过去、触景生情、提到回忆或从前",
      "melancholy: 低落、难过、失落、脆弱",
      "happy: 明显开心、兴奋、愉悦",
      "distant: 疏离、敷衍、心不在焉、想结束话题",
      "没有明确信号就把这一条省掉。只输出 JSON 数组，不要解释：",
      '[{ "i": 0, "state": "" }]',
    ].join("\n"),
    en: [
      "You are labelling one stretch of chat with the persona's mood at the time. Judge by their tone, not by what the user said.",
      "state must be one of these, with the same meanings as the emotion classifier:",
      "warm: relaxed, affectionate, responsive",
      "playful: joking, lively, a little spoiled",
      "nostalgic: thinking back, reminded of the past, mentioning memories",
      "melancholy: low, sad, vulnerable",
      "happy: clearly happy, excited, cheerful",
      "distant: aloof, perfunctory, distracted, ending the topic",
      "If there is no clear signal, omit that item. Return a JSON array only, with no explanation:",
      '[{ "i": 0, "state": "" }]',
    ].join("\n"),
  },
  "prompts.distill.confirmHarm": {
    zh: [
      "你在判断对方说过的话：这一句是在伤害听的人，还是玩笑、引用、或在说别人。",
      "只看这一句本身。伤害包括辱骂、贬低、威胁、限制对方。",
      "harm 为 true 表示确认是在伤害听的人；false 表示不是。",
      "只输出 JSON 数组，不要解释：",
      '[{ "i": 0, "harm": true }]',
    ].join("\n"),
    en: [
      "You are judging a line they said: is it hurting the person who heard it, or is it a joke, a quote, or about someone else?",
      "Judge the line itself. Harm includes insult, belittling, threat, and restricting the other person.",
      "harm is true when the line is hurting the listener; false when it is not.",
      "Return a JSON array only, with no explanation:",
      '[{ "i": 0, "harm": true }]',
    ].join("\n"),
  },
  "prompts.distill.labelActs": {
    zh: [
      "你在给一轮对话标言语动作。prev 是用户说的，text 是对方说的。",
      "act 必须是这些之一（对方）：",
      "{{taActs}}",
      "prevAct 必须是这些之一（用户）：",
      "{{userActs}}",
      "不在名单里的值不要写。只输出 JSON 数组，不要解释：",
      '[{ "i": 0, "act": "", "prevAct": "" }]',
    ].join("\n"),
    en: [
      "You are labelling one round of chat with speech acts. prev is what the user said; text is what the other person said.",
      "act must be one of these (the other person):",
      "{{taActs}}",
      "prevAct must be one of these (the user):",
      "{{userActs}}",
      "Drop values that are not on the lists. Return a JSON array only, with no explanation:",
      '[{ "i": 0, "act": "", "prevAct": "" }]',
    ].join("\n"),
  },
  "clarify.address_normal": { zh: "{{name}} 平时怎么叫你？", en: "What does {{name}} usually call you?" },
  "clarify.address_angry": { zh: "{{name}} 生气的时候怎么叫你？", en: "What does {{name}} call you when they are angry?" },
  "clarify.period_angry": { zh: "{{name}} 生气的时候，句子末尾会带句号吗？", en: "When {{name}} is angry, do the sentences end with a full stop?" },
  "clarify.laugh_form": { zh: "{{name}} 笑的时候打什么字？", en: "What does {{name}} type when they laugh?" },
  "clarify.goodnight": { zh: "你说晚安，{{name}} 一般回什么？", en: "When you say goodnight, what does {{name}} usually reply?" },
  "clarify.when_sad": { zh: "你难过的时候，{{name}} 通常怎么做？", en: "When you are sad, what does {{name}} usually do?" },
  "clarify.conflict_first": { zh: "吵架之后，一般谁先开口？", en: "After a fight, who usually speaks first?" },
  "clarify.sticker_habit": { zh: "{{name}} 爱发表情包吗？", en: "Does {{name}} send stickers a lot?" },
  "clarify.never_says": { zh: "有没有哪句话是 {{name}} 绝对不会说的？", en: "Is there a line {{name}} would never say?" },
  "clarify.avoid_topic": { zh: "有没有 {{name}} 不愿意聊的话题？", en: "Is there a topic {{name}} would rather not talk about?" },
  "clarify.confirm_rule": {
    zh: "「{{trigger}}」在 {{name}} 那里，是不是「{{meaning}}」的意思？",
    en: "When {{name}} says \"{{trigger}}\", does it mean \"{{meaning}}\"?",
  },
  "clarify.yes": { zh: "是", en: "Yes" },
  "clarify.no": { zh: "不是", en: "No" },
  "clarify.will": { zh: "会", en: "They do" },
  "clarify.wont": { zh: "不会", en: "They do not" },
  "clarify.unsure": { zh: "不确定", en: "Not sure" },
  "clarify.me": { zh: "我", en: "Me" },
  "clarify.either": { zh: "不一定", en: "It varies" },
  "clarify.same": { zh: "和平时一样", en: "The same as usual" },
  "clarify.whenSad.advise": { zh: "讲道理", en: "Talk it through" },
  "clarify.whenSad.stay": { zh: "陪着不多说", en: "Stay nearby without saying much" },
  "clarify.whenSad.joke": { zh: "逗你笑", en: "Try to make you laugh" },
  "clarify.whenSad.close": { zh: "说些亲近的话", en: "Say something close" },
  "clarify.whenSad.ask": { zh: "问你怎么了", en: "Ask what is wrong" },
  "clarify.whenSad.meaning": { zh: "你难过", en: "you are sad" },
  "clarify.sticker.often": { zh: "很多", en: "A lot" },
  "clarify.sticker.sometimes": { zh: "偶尔", en: "Sometimes" },
  "clarify.sticker.rarely": { zh: "几乎不发", en: "Almost never" },
  "clarify.addressAngry.meaning": { zh: "生气", en: "angry" },
  "clarify.addressAngry.rendering": {
    zh: "生气时这样叫，平时不这样叫",
    en: "This name is used when angry, not at other times",
  },
  "clarify.periodAngry.note": { zh: "句末带句号", en: "Sentences end with a full stop" },
  "clarify.conflictFirst.meaning": { zh: "刚吵完", en: "just after a fight" },
  "clarify.conflictFirst.them": { zh: "一般是 {{name}} 先开口", en: "{{name}} usually speaks first" },
  "clarify.conflictFirst.me": { zh: "一般是我先开口", en: "I usually speak first" },
  "clarify.conflictFirst.either": { zh: "不一定谁先开口", en: "It is not always the same person who speaks first" },
  "eval.discriminator.insufficient": {
    zh: "样本不够（{{n}} / {{need}}）。",
    en: "Not enough samples ({{n}} / {{need}}).",
  },
  "eval.drift.needUserSide": {
    zh: "记录里你这一侧的话不够，模拟不了",
    en: "There are not enough of your own lines in the record to simulate you.",
  },
  "eval.audition.failed": {
    zh: "这个模型没有答出来",
    en: "This model did not answer.",
  },
  "eval.ablate.helps": { zh: "有贡献", en: "helps" },
  "eval.ablate.noise": { zh: "在噪声之内", en: "within noise" },
  "eval.ablate.worse": { zh: "变差了", en: "worse" },
  "eval.blind.needEval": {
    zh: "先跑一次评测。",
    en: "Run an evaluation first.",
  },
  "eval.blind.finished": {
    zh: "这一场已经答完了。",
    en: "That sitting is already finished.",
  },
  "eval.blind.verdict.real": { zh: "真话", en: "real" },
  "eval.blind.verdict.persona": { zh: "分身", en: "persona" },
  "eval.blind.verdict.unsure": { zh: "猜不出", en: "unsure" },
  "eval.blind.export.group": { zh: "组", en: "group" },
  "eval.blind.export.subject": { zh: "被试", en: "subject" },
  "eval.blind.export.verdict": { zh: "判定", en: "verdict" },
  "eval.blind.export.seconds": { zh: "秒", en: "seconds" },
  "eval.blind.export.reason": { zh: "理由原文", en: "reason" },
  "eval.choice.missing": {
    zh: "这两句已经选过了，或者不是这一轮给的。",
    en: "Those two lines have already been chosen, or they were not the pair for this turn.",
  },
  "labels.emotion.warm": { zh: "温柔", en: "Warm" },
  "labels.emotion.playful": { zh: "俏皮", en: "Playful" },
  "labels.emotion.nostalgic": { zh: "思念", en: "Nostalgic" },
  "labels.emotion.melancholy": { zh: "忧郁", en: "Melancholy" },
  "labels.emotion.happy": { zh: "开心", en: "Happy" },
  "labels.emotion.distant": { zh: "疏离", en: "Distant" },
  "v6.stateRule.period": {
    zh: "这种时候句末带句号，平时不带",
    en: "In this mood they end on a period; they usually don't.",
  },
  "v6.stateRule.address": {
    zh: "这种时候这样叫对方，平时不这样叫",
    en: "In this mood they call the other person this; they usually don't.",
  },
  "v6.stateRule.particle": {
    zh: "这种时候句末爱用这个字",
    en: "In this mood they like this particle at the end of a line.",
  },
  "v6.stateRule.ellipsis": {
    zh: "这种时候话常常不说完",
    en: "In this mood they often trail off.",
  },
  "v6.imperfection.short": {
    zh: "话很短，通常不超过 {{n}} 个字",
    en: "The lines are short, usually no more than {{n}} characters.",
  },
  "v6.imperfection.long": {
    zh: "话变多，一条常常有 {{n}} 个字",
    en: "The lines get longer; one is often {{n}} characters.",
  },
  "v6.imperfection.burst": {
    zh: "一口气连发好几条",
    en: "They send several in a row.",
  },
  "v6.imperfection.single": {
    zh: "一次只发一条",
    en: "They send one at a time.",
  },
  "v6.imperfection.noSticker": {
    zh: "不发表情包",
    en: "They don't send stickers.",
  },
  "v6.imperfection.noLaugh": {
    zh: "不笑，不打「哈哈」",
    en: "They don't laugh, and they don't type haha.",
  },
  "v6.imperfection.slow": {
    zh: "回得慢，常常隔 {{m}} 分钟",
    en: "They reply slowly, often after {{m}} minutes.",
  },
  "v6.imperfection.period": {
    zh: "句末带句号",
    en: "They end on a period.",
  },
  "prompts.distill.lexiconFilter": {
    zh: [
      "你在看这两个人聊天里反复出现、又不是日常用词的说法。",
      "材料是候选词和原话。只从清单里勾出只在这两个人之间才有的说法、外号、梗。",
      "每个给一句不超过 20 字的解释。",
      "清单里没有的词不要写。",
      "只输出 JSON 数组，不要解释：",
      '[{ "term": "", "gloss": "" }]',
    ].join("\n"),
    en: [
      "You are looking at phrases that keep turning up in these two people's chat and are not everyday language.",
      "The material is candidate terms and quoted lines. From that list only, pick the nicknames, in-jokes, and private phrases that belong to these two people.",
      "Give each one a gloss of at most 20 characters.",
      "Do not write a term that is not on the list.",
      "Return a JSON array only, with no explanation:",
      '[{ "term": "", "gloss": "" }]',
    ].join("\n"),
  },
  "prompt.lexiconLine": {
    zh: "你们之间的说法：{{term}}——{{gloss}}",
    en: "A phrase between you: {{term}} — {{gloss}}",
  },
  "prompt.seedTurnsPrefix": {
    zh: "〔旧记录〕",
    en: "[earlier]",
  },
  "prompt.seedTurnsNote": {
    zh: "对话开头有几组带〔旧记录〕标记的往来，那是你和对方以前真实说过的话，放在这里只是让你记起自己说话的样子。里面提到的事不是刚发生的，不要当成现在的话题接着说，也不要提起「刚才」说过它们。",
    en: "A few exchanges at the start of this conversation are marked [earlier]. Those are things you and they actually said, placed here only so you remember how you talk. What they mention did not just happen. Do not continue them as the present topic, and do not mention having just said them.",
  },
  "prompt.styleReminderHeading": {
    zh: "【你平时的几句话】",
    en: "【A few of your usual lines】",
  },
  "prompt.actClustersHeading": {
    zh: "【你做这件事时说过的话】",
    en: "【Lines you used when doing this】",
  },
  "prompt.coldLinesHeading": {
    zh: "【你冷下来的时候说过的话】",
    en: "【Lines from when you went cold】",
  },
  "prompt.triggersHeading": {
    zh: "【这些话之后你通常会不高兴】",
    en: "【After these, you usually went cold】",
  },
  "prompt.repairLinesHeading": {
    zh: "【你以前是这样和好的】",
    en: "【How you used to make up】",
  },
  "prompt.closingOverlay": {
    zh: "这一轮说完就该结束这次聊天了。用你平时收尾的方式。",
    en: "This turn should end the chat. Close it the way you usually do.",
  },
  "prompt.closingHeading": {
    zh: "【你平时这样收尾】",
    en: "【How you usually close】",
  },
  "prompt.suppression.multi_point": {
    zh: "- 对方一次说了几件事时，只接其中一件。{{pattern}}",
    en: "- When they say several things at once, pick up only one of them. {{pattern}}",
  },
  "labels.multiPoint.preferLast": {
    zh: "通常接最后一件",
    en: "Usually pick up the last thing.",
  },
  "labels.multiPoint.preferFirst": {
    zh: "通常接第一件",
    en: "Usually pick up the first thing.",
  },
  "labels.multiPoint.pair": {
    zh: "对方：{{user}}\n你：{{reply}}",
    en: "Them: {{user}}\nYou: {{reply}}",
  },
  "prompt.inSessionShare": {
    zh: "这一轮回完之后，可以顺带说一句自己的事：{{fact}}",
    en: "After you have answered this turn, you may add one thing of your own: {{fact}}",
  },
  "prompt.contrastHeading": {
    zh: "【不像的，和像的】",
    en: "【Unlike, and like】",
  },
  "prompt.contrastLine": {
    zh: "不像：{{unlike}}　像：{{rewrite}}",
    en: "Unlike: {{unlike}}  Like: {{rewrite}}",
  },
  "labels.export.rewritePairs": {
    zh: "不像的，和像的",
    en: "Unlike, and like",
  },
  "labels.export.rewritePair": {
    zh: "不像：{{unlike}}　像：{{rewrite}}",
    en: "Unlike: {{unlike}}  Like: {{rewrite}}",
  },
  "prompt.reanchor": {
    zh: "你最近几句{{issues}}。回到平时的样子。",
    en: "Your last few lines {{issues}}. Go back to how you usually talk.",
  },
  "prompt.reanchorIssueLong": {
    zh: "写得比平时长",
    en: "ran longer than usual",
  },
  "prompt.reanchorIssueQuestion": {
    zh: "总以问句收尾",
    en: "kept ending on a question",
  },
  "prompt.reanchorIssuePeriod": {
    zh: "带了平时不带的句号",
    en: "used periods you do not usually use",
  },
  "prompt.reanchorIssueCliche": {
    zh: "开头在复述对方的感受",
    en: "opened by restating how they feel",
  },
  "prompts.twoStage.planner": {
    zh: '不要扮演。只决定这一轮 TA 会做什么、说哪件事。输出 JSON：{ "gist": "不超过 40 字的中性描述", "mentions": [用到的记忆 id], "length": "short|medium|long" }。动作已经定了：{{act}}。不要加入材料里没有的事实。',
    en: 'Do not role-play. Only decide what they would do this turn, and which matter they would speak to. Return JSON: { "gist": "a neutral description of at most 40 characters", "mentions": [memory ids used], "length": "short|medium|long" }. The action is already chosen: {{act}}. Do not add facts that are not in the material.',
  },
  "prompts.twoStage.voice": {
    zh: "这一轮要说的意思是：{{gist}}。用你自己的话说出来，不要加别的事。",
    en: "What this turn is meant to say: {{gist}}. Say it in your own words, and do not add anything else.",
  },
  "prompts.twoStage.actNone": {
    zh: "未指定",
    en: "unspecified",
  },
  "labels.lexicon.mine": {
    zh: "从记录里挖词",
    en: "Mine words from the records",
  },
  "labels.lexicon.minedNone": {
    zh: "记录里没有挖到专属的说法。",
    en: "The records did not yield a private phrase.",
  },
  "prompt.memoryMarkerSaid": {
    zh: "（这是你在这里说过的话，不是记录里的事实）",
    en: " (this is something you said here, not a fact from the records)",
  },
} as const satisfies CopyTable;
