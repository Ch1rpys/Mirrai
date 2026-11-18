# 出站清单

应用会主动连到机器外面的每一处。新增出站必须先登记进 `shared/egress.ts`，默认关（已有的 Edge TTS 除外），并在设置里写明发了什么。

名人研究流程（`server/skill-engine/celebrity.ts`）只通过已配置的 LLM provider 调模型，自己不发 HTTP，所以不单列一行。

| id | 连到哪 | 发什么 | 何时 | 默认 | 在哪关 | 侧 |
|---|---|---|---|---|---|---|
| llm-openai-compatible | 用户配置的 OpenAI 兼容地址（默认 api.openai.com，也可填自建或第三方） | 对话的系统提示词、历史和当前一句；密钥在 Authorization 头里 | 分身回复、蒸馏、评测，以及任何走这个 provider 的模型调用 | 关 | 设置里不配这个 provider，或删掉密钥 | server |
| stt-openai-compatible | 同一套 OpenAI 兼容地址的 /audio/transcriptions | 语音文件的字节，以及转写模型名 | 用户转写一条语音消息时 | 关 | 不配 OpenAI 兼容 provider，或不去转写语音 | server |
| llm-claude | 用户配置的 Anthropic 地址（默认 api.anthropic.com） | 对话内容；密钥在 x-api-key 头里 | 这个分身被设成走 Claude 时 | 关 | 设置里不配 Claude，或改用别的 provider | server |
| ollama-embed | 本机 Ollama 的 /api/embed（地址来自 OLLAMA_URL，通常是 http://127.0.0.1:11434） | 要检索的那一句，以及每一轮 TA 回复之前用户那一轮的原文。连本机时数据不出这台机器 | 本机 Ollama 装着嵌入模型时：测量画像之后给记录建向量，以及检索示范时 | 关 | 停掉 Ollama，或不装嵌入模型（OLLAMA_EMBED_MODEL） | server |
| llm-ollama | 用户配置的 Ollama 地址（通常是本机 http://127.0.0.1:11434） | 对话内容。连本机时数据不出这台机器 | 这个分身被设成走 Ollama 时 | 关 | 设置里不配 Ollama | server |
| llm-dify | 用户配置的 Dify 地址 | 当前一句用户消息；密钥在请求里 | 这个分身被设成走 Dify 时 | 关 | 设置里不配 Dify | server |
| llm-xunfei | 讯飞星火 wss://spark-api.xf-yun.com | 对话内容；鉴权写在 WebSocket URL 里 | 这个分身被设成走讯飞时 | 关 | 设置里不配讯飞密钥 | server |
| tts-edge | 微软 Edge 在线朗读（edge-tts 包连到 Microsoft 的语音服务） | 要读出来的那段文字，以及所选的声音名 | 用户点朗读，且 TTS_ENABLED 未关时 | 开 | 环境变量 TTS_ENABLED=false | server |
| channel-wechat-ilink | 微信 iLink https://ilinkai.weixin.qq.com（会话里也可能被重定向到别的微信主机） | 登录、收发消息所需的协议字段；不含分身的系统提示词 | 用户在通道里启用微信并完成登录之后 | 关 | 设置 → 通道里停掉微信 | server |
| channel-feishu | 飞书开放平台（@larksuiteoapi/node-sdk，含 WebSocket 长连接） | 应用凭证，以及这个通道上收发的消息正文 | 用户在通道里启用飞书并填入应用凭证之后 | 关 | 设置 → 通道里停掉飞书 | server |
| collector-feishu | 飞书开放平台（子进程 feishu_auto_collector.py） | 应用凭证，以及要采集的会话范围 | 用户主动跑飞书采集器时 | 关 | 不要跑采集器；凭证留空它也不会发请求 | server |
| collector-dingtalk | 钉钉开放平台（子进程 dingtalk_auto_collector.py） | 应用凭证，以及要采集的会话范围 | 用户主动跑钉钉采集器时 | 关 | 不要跑采集器 | server |
| collector-slack | Slack Web API（子进程 slack_auto_collector.py） | 访问令牌，以及要采集的频道范围 | 用户主动跑 Slack 采集器时 | 关 | 不要跑采集器 | server |
| collector-email | 不联网：子进程 email_parser.py 只解析本机上的邮件导出文件 | 不发送。读的是用户选定的本地文件 | 用户导入一份邮件导出时 | 关 | 不要跑这个采集器 | server |
| collector-wechat-export | 不联网：子进程 feishu_parser.py 只解析本机上的微信导出文件 | 不发送。读的是用户选定的本地文件 | 用户导入一份微信导出时 | 关 | 不要跑这个采集器 | server |
