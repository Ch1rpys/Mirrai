/**
 * The words for the sixth-stage work, starting with the record table.
 */
import type { CopyTable } from "./index";

export const V6 = {
  "errors.recordsLimit": {
    zh: "这个分身已经有 {{current}} 条记录，再写入 {{incoming}} 条会超过上限 {{max}}。",
    en: "This persona already has {{current}} records; writing {{incoming}} more would go past the limit of {{max}}.",
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
} as const satisfies CopyTable;
