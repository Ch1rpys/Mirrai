# 出站清单

应用会主动连到机器外面的每一处。新增出站必须先登记进 `shared/egress.ts`，默认关（已有的 Edge TTS 除外），并在设置里写明发了什么。

名人研究流程（`server/skill-engine/celebrity.ts`）只通过已配置的 LLM provider 调模型，自己不发 HTTP，所以不单列一行。

| id | 连到哪 | 发什么 | 何时 | 默认 | 在哪关 | 侧 |
|---|---|---|---|---|---|---|
| llm-openai-compatible | 用户配置的 OpenAI 兼容地址（默认 api.openai.com，也可填自建或第三方） | 对话的系统提示词、历史和当前一句；导入截图时，截图图片本身也走这里；密钥在 Authorization 头里 | 分身回复、蒸馏、评测、截图识别，以及任何走这个 provider 的模型调用 | 关 | 设置里不配这个 provider，或删掉密钥 | server |
| stt-openai-compatible | 同一套 OpenAI 兼容地址的 /audio/transcriptions | 语音文件的字节，以及转写模型名 | 用户转写一条语音消息时 | 关 | 不配 OpenAI 兼容 provider，或不去转写语音 | server |
| stt-local-http | 你自己起的语音识别服务（STT_HTTP_URL，默认必须是本机或局域网地址） | 语音文件的字节。导入记录里的录音只走本机引擎，不会发到别处 | STT_ENGINE=http 时转写一条语音，或转写导入记录里的语音条 | 关 | 不设 STT_ENGINE=http，或把它设成 off；也可以停掉那个服务 | server |
| llm-claude | 用户配置的 Anthropic 地址（默认 api.anthropic.com） | 对话内容；密钥在 x-api-key 头里 | 这个分身被设成走 Claude 时 | 关 | 设置里不配 Claude，或改用别的 provider | server |
| ollama-embed | 本机 Ollama 的 /api/embed 和状态查询 /api/tags（地址来自 OLLAMA_URL，通常是 http://127.0.0.1:11434） | 要检索的那一句，以及每一轮 TA 回复之前用户那一轮的原文；状态查询只读模型列表。连本机时数据不出这台机器 | 本机 Ollama 装着嵌入模型时：测量画像之后给记录建向量，以及检索示范时；设置页显示语义检索状态时 | 关 | 停掉 Ollama，或不装嵌入模型（OLLAMA_EMBED_MODEL） | server |
| llm-ollama | 用户配置的 Ollama 地址（通常是本机 http://127.0.0.1:11434） | 对话内容。连本机时数据不出这台机器 | 这个分身被设成走 Ollama 时 | 关 | 设置里不配 Ollama | server |
| llm-dify | 用户配置的 Dify 地址 | 当前一句用户消息；密钥在请求里 | 这个分身被设成走 Dify 时 | 关 | 设置里不配 Dify | server |
| llm-xunfei | 讯飞星火 wss://spark-api.xf-yun.com | 对话内容；鉴权写在 WebSocket URL 里 | 这个分身被设成走讯飞时 | 关 | 设置里不配讯飞密钥 | server |
| tts-edge | 微软 Edge 在线朗读（edge-tts 包连到 Microsoft 的语音服务） | 要读出来的那段文字，以及所选的声音名 | 用户点朗读，TTS_ENABLED 未关，且 TTS_ENGINE 是 edge 时（其他引擎在本机合成） | 开 | 环境变量 TTS_ENABLED=false | server |
| channel-wechat-ilink | 微信 iLink https://ilinkai.weixin.qq.com（会话里也可能被重定向到别的微信主机） | 登录、收发消息所需的协议字段；不含分身的系统提示词 | 用户在通道里启用微信并完成登录之后 | 关 | 设置 → 通道里停掉微信 | server |
| channel-feishu | 飞书开放平台（@larksuiteoapi/node-sdk，含 WebSocket 长连接） | 应用凭证，以及这个通道上收发的消息正文 | 用户在通道里启用飞书并填入应用凭证之后 | 关 | 设置 → 通道里停掉飞书 | server |
| collector-feishu | 飞书开放平台（子进程 feishu_auto_collector.py） | 应用凭证，以及要采集的会话范围 | 用户主动跑飞书采集器时 | 关 | 不要跑采集器；凭证留空它也不会发请求 | server |
| collector-dingtalk | 钉钉开放平台（子进程 dingtalk_auto_collector.py） | 应用凭证，以及要采集的会话范围 | 用户主动跑钉钉采集器时 | 关 | 不要跑采集器 | server |
| collector-slack | Slack Web API（子进程 slack_auto_collector.py） | 访问令牌，以及要采集的频道范围 | 用户主动跑 Slack 采集器时 | 关 | 不要跑采集器 | server |
| collector-email | 不联网：子进程 email_parser.py 只解析本机上的邮件导出文件 | 不发送。读的是用户选定的本地文件 | 用户导入一份邮件导出时 | 关 | 不要跑这个采集器 | server |
| collector-wechat-export | 不联网：子进程 feishu_parser.py 只解析本机上的微信导出文件 | 不发送。读的是用户选定的本地文件 | 用户导入一份微信导出时 | 关 | 不要跑这个采集器 | server |
| map-tiles | 运营方设置的 MAP_TILE_URL 指向的地图瓦片服务器（默认没有） | 正在看的那一片地图的图片请求。不发送记录内容；只有瓦片坐标 | 用户在「去过的地方」里打开「加载地图底图」之后 | 关 | 不打开地图底图；运营方不设 MAP_TILE_URL 时这个开关根本不出现 | client |
| push-browser | 浏览器厂商的推送服务（地址由浏览器在订阅时给出，例如 fcm.googleapis.com 或 push.services.mozilla.com） | 加密后的通知负载。默认只有种类、分身编号和打开对话的地址，不含名字和内容 | 用户打开了「应用关着的时候也提醒我」，并且有一条主动开口、回信或提醒要送到网页时 | 关 | 设置里关掉「应用关着的时候也提醒我」，或在系统里取消通知权限 | server |
| ldr-geocoding | Open-Meteo 的地理编码接口 geocoding-api.open-meteo.com | 用户在「查找城市」里输入的那几个字。不发送分身、记录或用户标识 | 用户点了「查找」按钮时，一次点击一次请求 | 关 | 不点「查找」；或环境变量 WEATHER_ENABLED=false 把整个入口关掉 | server |
| ldr-weather | Open-Meteo 的天气接口 api.open-meteo.com | 四舍五入到小数点后两位的经纬度。不带城市名、记录内容或用户标识 | 用户打开「显示 TA 那边的天气」之后，最多每 30 分钟一次 | 关 | 关掉「显示 TA 那边的天气」；或环境变量 WEATHER_ENABLED=false | server |
| letter-email | 用户自己填的 SMTP 邮件服务器 | 分身回信的全文，以及收件地址（用户自己的邮箱）。不带记录、不带图片、不带追踪像素 | 用户为这个分身打开「回信也发到我的邮箱」，并且一封信被回信时 | 关 | 关掉「回信也发到我的邮箱」，或清掉设置里的邮件服务器 | server |
| channel-telegram | Telegram Bot API（api.telegram.org） | 长轮询的更新请求（没有内容）；发出的回复文本；机器人 token 在 URL 路径里 | 用户自己启动 Telegram 通道之后，持续发生 | 关 | 在设置里停止这个通道，或清掉它的机器人 token | server |
| channel-discord | Discord Gateway（wss://gateway.discord.gg）与 Discord REST API（discord.com/api） | Gateway 连接（心跳与事件）；收到和发出的私信文本；机器人 token 在 Authorization 头与 identify 负载里 | 用户自己启动 Discord 通道之后，持续发生 | 关 | 在设置里停止这个通道，或清掉它的机器人 token | server |
| channel-matrix | 用户自己填的 Matrix homeserver | /sync 长轮询与发出的 m.room.message；私信文本；访问令牌在 Authorization 头里 | 用户自己启动 Matrix 通道之后，持续发生 | 关 | 在设置里停止这个通道，或清掉它的访问令牌 | server |

| backup-webdav | 用户自己填的 WebDAV 服务器 | 加密后的备份文件本身，以及它的文件名。Basic 认证的用户名和密码在请求头里 | 用户打开了定时备份、目标是 WebDAV，并且到了那天 | 关 | 关掉定时备份，或把目标改成本机的一个文件夹 | server |
| backup-s3 | 用户自己填的 S3 兼容存储端点 | 加密后的备份文件本身，以及对象名。SigV4 签名的请求头和访问密钥标识在请求里，密钥本身不外发 | 用户打开了定时备份、目标是 S3 兼容存储，并且到了那天 | 关 | 关掉定时备份，或把目标改成本机的一个文件夹 | server |