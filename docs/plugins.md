# 本机插件

插件是**你自己放进数据目录的代码**，在 Mirrai 的进程里运行，权限和应用本身一样大。
没有远程安装，没有市场——只有一个文件夹，和启动时读它一次。

## 打开

1. 把插件目录放到 `<数据目录>/plugins/<插件名>/index.mjs`。
   数据目录默认是 `uploads/` 旁边的那一层；设了 `MIRRAI_DATA_ROOT` 时就是它。
2. 带环境变量启动应用：

```bash
MIRRAI_PLUGINS=on corepack pnpm dev
```

默认是关的。没打开时这个目录**不会被读**。改动插件后要重启应用才会生效。
一个插件加载失败只会在日志里留一行，应用照常启动。

设置 → 数据管理 →「已加载的插件」列出这一次启动读到的插件，以及每个插件
**声明**的出站地址。声明只是声明：应用不执行它、它也不限制插件——插件能做
应用能做的一切，包括连到任何地方。

## 插件的形状

`index.mjs` 的默认导出：

```js
export default {
  name: "my-plugin",        // 字母、数字、点、横线、下划线
  version: "1.0.0",
  kind: "importer",         // 或 "channel"
  egress: ["https://example.com"],  // 可选：它说它会连到哪
  create() { /* 返回导入器或通道适配器 */ },
};
```

`create()` 的返回值按 `kind` 校验，形状不对的插件会被跳过并在日志里说明缺了什么。

### 导入器插件（kind: "importer"）

返回一个对象，满足 [`server/importers/types.ts`](../server/importers/types.ts)
里的 `Importer` 接口：

```js
{
  id: "myformat",                     // 寄存器里的 id 会变成 plugin:<插件名>:myformat
  label: { zh: "我的格式", en: "My format" },
  source: "generic",                  // 记录行 source 列的取值（最长 32 字符）
  detect(source) { /* 返回 { id, confidence } 或 null */ },
  async parse(source) {
    // source = { fileName, bytes, text }
    return { records, speakers, warnings: [], skipped: 0 };
  },
}
```

`records` 是 `ParsedRecord` 数组（`speaker`、`content`、`timestamp`、`kind`、
`lineNo`、可选 `meta`）。插件被注册后，导入向导的格式列表和自动识别都会看到
它，和内置格式走同一条 `startImport` 写入路径。

最小的例子：[`examples/plugins/echo-importer`](../examples/plugins/echo-importer)，
一个读 `speaker: message` 文本行的导入器。把它整个目录复制到
`<数据目录>/plugins/` 就能用。

### 通道插件（kind: "channel"）

返回一个对象，满足 [`server/channels/types.ts`](../server/channels/types.ts)
里的 `ChannelAdapter` 接口（`label`、`requiresCredentials`、`start`、`stop`、
`status`、`send`、`setDefaultPersona`；`labelForLocale`、`stopAll`、`restore`
可选）。注册时 id 同样加前缀 `plugin:<插件名>:`。

通道插件自己负责和平台的协议。它的入站消息要落到对话里时，可以调用
`server/channels/bridge.ts` 的 `handleChannelChat`——但请注意：消息表能存的
通道名是固定的那几个，插件通道目前没有自己的 `channel` 枚举值，所以
`handleChannelChat` 要传一个已有的通道名，库里会记成那个名字。等你确实要长期
用一个插件通道时，这里需要单独加一个枚举值。

## 安全

- 插件在应用进程里执行，可以读数据库、写文件、发网络请求。它没有任何沙箱。
- 只放你读过、信得过的代码。别人给你的插件，和你自己写的程序一样危险。
- 关掉开关（不设 `MIRRAI_PLUGINS=on`）就完全不加载。
