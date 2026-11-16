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
} as const satisfies CopyTable;
