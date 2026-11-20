/**
 * The closed inventory of outbound connections.
 *
 * "Data stays on this machine" is a promise the settings page has to
 * be able to show. Every place the app talks to the network is listed
 * here; the document, the guard test and the data-management panel all
 * read this array.
 */
export type EgressSide = "server" | "client";

export interface EgressCopy {
  zh: string;
  en: string;
}

export interface EgressItem {
  id: string;
  side: EgressSide;
  destination: EgressCopy;
  payload: EgressCopy;
  when: EgressCopy;
  defaultOn: boolean;
  offHow: EgressCopy;
}

export const EGRESS_ITEMS: EgressItem[] = [
  {
    id: "llm-openai-compatible",
    side: "server",
    destination: {
      zh: "用户配置的 OpenAI 兼容地址（默认 api.openai.com，也可填自建或第三方）",
      en: "The OpenAI-compatible URL the user configured (api.openai.com by default, or a self-hosted / third-party host)",
    },
    payload: {
      zh: "对话的系统提示词、历史和当前一句；导入截图时，截图图片本身也走这里；密钥在 Authorization 头里",
      en: "The system prompt, the history and the current turn; screenshot imports also send the image itself; the API key in the Authorization header",
    },
    when: {
      zh: "分身回复、蒸馏、评测、截图识别，以及任何走这个 provider 的模型调用",
      en: "A reply, a distillation, an evaluation, a screenshot import, or any other call that uses this provider",
    },
    defaultOn: false,
    offHow: {
      zh: "设置里不配这个 provider，或删掉密钥",
      en: "Leave this provider unconfigured in Settings, or remove its key",
    },
  },
  {
    id: "stt-openai-compatible",
    side: "server",
    destination: {
      zh: "同一套 OpenAI 兼容地址的 /audio/transcriptions",
      en: "The same OpenAI-compatible host, at /audio/transcriptions",
    },
    payload: {
      zh: "语音文件的字节，以及转写模型名",
      en: "The bytes of the voice file, and the transcription model name",
    },
    when: {
      zh: "用户转写一条语音消息时",
      en: "When the user transcribes a voice message",
    },
    defaultOn: false,
    offHow: {
      zh: "不配 OpenAI 兼容 provider，或不去转写语音",
      en: "Leave the OpenAI-compatible provider unconfigured, or do not transcribe voice notes",
    },
  },
  {
    id: "stt-local-http",
    side: "server",
    destination: {
      zh: "你自己起的语音识别服务（STT_HTTP_URL，默认必须是本机或局域网地址）",
      en: "The speech-to-text service you run yourself (STT_HTTP_URL; on this machine or the LAN by default)",
    },
    payload: {
      zh: "语音文件的字节。导入记录里的录音只走本机引擎，不会发到别处",
      en: "The bytes of the recording. Voice notes in an imported record only ever go to a local engine",
    },
    when: {
      zh: "STT_ENGINE=http 时转写一条语音，或转写导入记录里的语音条",
      en: "With STT_ENGINE=http: a voice message, or a voice note in an imported record",
    },
    defaultOn: false,
    offHow: {
      zh: "不设 STT_ENGINE=http，或把它设成 off；也可以停掉那个服务",
      en: "Leave STT_ENGINE at provider, set it to off, or stop the service",
    },
  },
  {
    id: "llm-claude",
    side: "server",
    destination: {
      zh: "用户配置的 Anthropic 地址（默认 api.anthropic.com）",
      en: "The Anthropic URL the user configured (api.anthropic.com by default)",
    },
    payload: {
      zh: "对话内容；密钥在 x-api-key 头里",
      en: "The conversation; the API key in the x-api-key header",
    },
    when: {
      zh: "这个分身被设成走 Claude 时",
      en: "When this persona is set to use Claude",
    },
    defaultOn: false,
    offHow: {
      zh: "设置里不配 Claude，或改用别的 provider",
      en: "Leave Claude unconfigured, or pick another provider",
    },
  },
  {
    id: "ollama-embed",
    side: "server",
    destination: {
      zh: "本机 Ollama 的 /api/embed（地址来自 OLLAMA_URL，通常是 http://127.0.0.1:11434）",
      en: "This machine's Ollama at /api/embed (OLLAMA_URL, usually http://127.0.0.1:11434)",
    },
    payload: {
      zh: "要检索的那一句，以及每一轮 TA 回复之前用户那一轮的原文。连本机时数据不出这台机器",
      en: "The query, and the user burst that came before each of their turns. A local URL does not leave this machine",
    },
    when: {
      zh: "本机 Ollama 装着嵌入模型时：测量画像之后给记录建向量，以及检索示范时",
      en: "When local Ollama has an embedding model: after measuring the style profile, and when retrieving exemplars",
    },
    defaultOn: false,
    offHow: {
      zh: "停掉 Ollama，或不装嵌入模型（OLLAMA_EMBED_MODEL）",
      en: "Stop Ollama, or do not install the embedding model (OLLAMA_EMBED_MODEL)",
    },
  },
  {
    id: "llm-ollama",
    side: "server",
    destination: {
      zh: "用户配置的 Ollama 地址（通常是本机 http://127.0.0.1:11434）",
      en: "The Ollama URL the user configured (usually http://127.0.0.1:11434 on this machine)",
    },
    payload: {
      zh: "对话内容。连本机时数据不出这台机器",
      en: "The conversation. A local URL does not leave this machine",
    },
    when: {
      zh: "这个分身被设成走 Ollama 时",
      en: "When this persona is set to use Ollama",
    },
    defaultOn: false,
    offHow: {
      zh: "设置里不配 Ollama",
      en: "Leave Ollama unconfigured in Settings",
    },
  },
  {
    id: "llm-dify",
    side: "server",
    destination: {
      zh: "用户配置的 Dify 地址",
      en: "The Dify URL the user configured",
    },
    payload: {
      zh: "当前一句用户消息；密钥在请求里",
      en: "The latest user message; the API key in the request",
    },
    when: {
      zh: "这个分身被设成走 Dify 时",
      en: "When this persona is set to use Dify",
    },
    defaultOn: false,
    offHow: {
      zh: "设置里不配 Dify",
      en: "Leave Dify unconfigured in Settings",
    },
  },
  {
    id: "llm-xunfei",
    side: "server",
    destination: {
      zh: "讯飞星火 wss://spark-api.xf-yun.com",
      en: "iFlytek Spark at wss://spark-api.xf-yun.com",
    },
    payload: {
      zh: "对话内容；鉴权写在 WebSocket URL 里",
      en: "The conversation; the credentials are in the WebSocket URL",
    },
    when: {
      zh: "这个分身被设成走讯飞时",
      en: "When this persona is set to use iFlytek",
    },
    defaultOn: false,
    offHow: {
      zh: "设置里不配讯飞密钥",
      en: "Leave the iFlytek keys unconfigured in Settings",
    },
  },
  {
    id: "tts-edge",
    side: "server",
    destination: {
      zh: "微软 Edge 在线朗读（edge-tts 包连到 Microsoft 的语音服务）",
      en: "Microsoft Edge online read-aloud (the edge-tts package talks to Microsoft speech)",
    },
    payload: {
      zh: "要读出来的那段文字，以及所选的声音名",
      en: "The text to be read, and the chosen voice id",
    },
    when: {
      zh: "用户点朗读，TTS_ENABLED 未关，且 TTS_ENGINE 是 edge 时（其他引擎在本机合成）",
      en: "When the user asks for speech, TTS_ENABLED is not off, and TTS_ENGINE is edge (the other engines synthesise on this machine)",
    },
    defaultOn: true,
    offHow: {
      zh: "环境变量 TTS_ENABLED=false",
      en: "Set TTS_ENABLED=false in the environment",
    },
  },
  {
    id: "channel-wechat-ilink",
    side: "server",
    destination: {
      zh: "微信 iLink https://ilinkai.weixin.qq.com（会话里也可能被重定向到别的微信主机）",
      en: "WeChat iLink at https://ilinkai.weixin.qq.com (a session may be redirected to another WeChat host)",
    },
    payload: {
      zh: "登录、收发消息所需的协议字段；不含分身的系统提示词",
      en: "The protocol fields needed to sign in and to send or receive messages; not the persona's system prompt",
    },
    when: {
      zh: "用户在通道里启用微信并完成登录之后",
      en: "After the user turns the WeChat channel on and signs in",
    },
    defaultOn: false,
    offHow: {
      zh: "设置 → 通道里停掉微信",
      en: "Stop the WeChat channel under Settings → Channels",
    },
  },
  {
    id: "channel-feishu",
    side: "server",
    destination: {
      zh: "飞书开放平台（@larksuiteoapi/node-sdk，含 WebSocket 长连接）",
      en: "Feishu Open Platform via @larksuiteoapi/node-sdk, including a long-lived WebSocket",
    },
    payload: {
      zh: "应用凭证，以及这个通道上收发的消息正文",
      en: "The app credentials, and the text of messages this channel sends or receives",
    },
    when: {
      zh: "用户在通道里启用飞书并填入应用凭证之后",
      en: "After the user turns the Feishu channel on and enters the app credentials",
    },
    defaultOn: false,
    offHow: {
      zh: "设置 → 通道里停掉飞书",
      en: "Stop the Feishu channel under Settings → Channels",
    },
  },
  {
    id: "collector-feishu",
    side: "server",
    destination: {
      zh: "飞书开放平台（子进程 feishu_auto_collector.py）",
      en: "Feishu Open Platform (subprocess feishu_auto_collector.py)",
    },
    payload: {
      zh: "应用凭证，以及要采集的会话范围",
      en: "The app credentials, and which chats to collect",
    },
    when: {
      zh: "用户主动跑飞书采集器时",
      en: "When the user runs the Feishu collector",
    },
    defaultOn: false,
    offHow: {
      zh: "不要跑采集器；凭证留空它也不会发请求",
      en: "Do not run the collector; with no credentials it sends nothing",
    },
  },
  {
    id: "collector-dingtalk",
    side: "server",
    destination: {
      zh: "钉钉开放平台（子进程 dingtalk_auto_collector.py）",
      en: "DingTalk Open Platform (subprocess dingtalk_auto_collector.py)",
    },
    payload: {
      zh: "应用凭证，以及要采集的会话范围",
      en: "The app credentials, and which chats to collect",
    },
    when: {
      zh: "用户主动跑钉钉采集器时",
      en: "When the user runs the DingTalk collector",
    },
    defaultOn: false,
    offHow: {
      zh: "不要跑采集器",
      en: "Do not run the collector",
    },
  },
  {
    id: "collector-slack",
    side: "server",
    destination: {
      zh: "Slack Web API（子进程 slack_auto_collector.py）",
      en: "Slack Web API (subprocess slack_auto_collector.py)",
    },
    payload: {
      zh: "访问令牌，以及要采集的频道范围",
      en: "The access token, and which channels to collect",
    },
    when: {
      zh: "用户主动跑 Slack 采集器时",
      en: "When the user runs the Slack collector",
    },
    defaultOn: false,
    offHow: {
      zh: "不要跑采集器",
      en: "Do not run the collector",
    },
  },
  {
    id: "collector-email",
    side: "server",
    destination: {
      zh: "不联网：子进程 email_parser.py 只解析本机上的邮件导出文件",
      en: "No network: subprocess email_parser.py only parses a mail export on this machine",
    },
    payload: {
      zh: "不发送。读的是用户选定的本地文件",
      en: "Nothing is sent. It reads a local file the user chose",
    },
    when: {
      zh: "用户导入一份邮件导出时",
      en: "When the user imports a mail export",
    },
    defaultOn: false,
    offHow: {
      zh: "不要跑这个采集器",
      en: "Do not run this collector",
    },
  },
  {
    id: "collector-wechat-export",
    side: "server",
    destination: {
      zh: "不联网：子进程 feishu_parser.py 只解析本机上的微信导出文件",
      en: "No network: subprocess feishu_parser.py only parses a WeChat export on this machine",
    },
    payload: {
      zh: "不发送。读的是用户选定的本地文件",
      en: "Nothing is sent. It reads a local file the user chose",
    },
    when: {
      zh: "用户导入一份微信导出时",
      en: "When the user imports a WeChat export",
    },
    defaultOn: false,
    offHow: {
      zh: "不要跑这个采集器",
      en: "Do not run this collector",
    },
  },
  {
    id: "push-browser",
    side: "server",
    destination: {
      zh: "浏览器厂商的推送服务（地址由浏览器在订阅时给出，例如 fcm.googleapis.com 或 push.services.mozilla.com）",
      en: "The browser vendor's push service (the address comes from the browser at subscribe time, for example fcm.googleapis.com or push.services.mozilla.com)",
    },
    payload: {
      zh: "加密后的通知负载。默认只有种类、分身编号和打开对话的地址，不含名字和内容",
      en: "An encrypted notification. By default it carries only the kind, the persona id and the chat URL, not the name or the text",
    },
    when: {
      zh: "用户打开了「应用关着的时候也提醒我」，并且有一条主动开口、回信或提醒要送到网页时",
      en: "When the user has asked to be notified while the app is closed, and a first message, a letter or a reminder is delivered on the web",
    },
    defaultOn: false,
    offHow: {
      zh: "设置里关掉「应用关着的时候也提醒我」，或在系统里取消通知权限",
      en: "Turn off “notify me while the app is closed” in Settings, or revoke the notification permission",
    },
  },
];
