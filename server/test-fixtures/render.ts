/**
 * Renders a fixture log into an on-disk export shape.
 *
 * Unknown formats are a hard error so a caller cannot silently
 * round-trip the wrong thing.
 */
import type { FixtureRecord } from "./xiaoman";
import { formatShanghai } from "./xiaoman";

export type FixtureFormat =
  | "generic-line"
  | "wechat-txt-2line"
  | "wechat-txt-paren"
  | "wechat-csv"
  | "wechat-json"
  | "qq-txt"
  | "qq-mht"
  | "telegram-json";

function textRows(records: FixtureRecord[]): FixtureRecord[] {
  return records.filter((row) => row.kind === "text" && row.content.trim());
}

function renderGenericLine(records: FixtureRecord[]): string {
  return textRows(records)
    .map((row) => `[${formatShanghai(row.timestamp)}] ${row.speaker}：${row.content.trim()}`)
    .join("\n");
}

function renderWechatTxt2Line(records: FixtureRecord[]): string {
  return textRows(records)
    .map((row) => `${formatShanghai(row.timestamp)} ${row.speaker}\n${row.content.trim()}`)
    .join("\n\n");
}

function renderWechatTxtParen(records: FixtureRecord[]): string {
  return textRows(records)
    .map((row) => `${row.speaker} (${formatShanghai(row.timestamp)}): ${row.content.trim()}`)
    .join("\n\n");
}

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** i18n:allow-identifier — QQ MHT MIME wrapper and 昵称(QQ号) headers. */
function renderQqMht(records: FixtureRecord[]): string {
  const body = textRows(records)
    .map((row) => {
      const id = row.speaker === "小满" ? "10001" : "10002";
      return `<div>${row.speaker}(${id}) ${formatShanghai(row.timestamp)}</div>\n<div>${row.content.trim().replace(/\n/g, "<br>")}</div>`;
    })
    .join("\n");
  return [
    "From: <Saved by Blink>",
    "MIME-Version: 1.0",
    'Content-Type: multipart/related; boundary="----=_NextPart"',
    "",
    "------=_NextPart",
    'Content-Type: text/html; charset="utf-8"',
    "",
    "<html><body>",
    "<div>消息记录</div>",
    "<div>消息对象:小满</div>",
    body,
    "</body></html>",
    "------=_NextPart--",
  ].join("\n");
}

/** i18n:allow-identifier — QQ TXT export banner; the parser matches these bytes. */
function renderQqTxt(records: FixtureRecord[]): string {
  const body = textRows(records)
    .map((row) => `${formatShanghai(row.timestamp)} ${row.speaker}\n${row.content.trim()}`)
    .join("\n\n");
  return [
    "消息记录（此消息记录为文本格式，不支持重新导入）",
    "",
    "================================================================",
    "消息对象:小满",
    "================================================================",
    "",
    body,
  ].join("\n");
}

/** i18n:allow-identifier — Telegram export chat title; the parser matches these bytes. */
function renderTelegramJson(records: FixtureRecord[]): string {
  const messages = textRows(records).map((row, index) => ({
    id: index + 1,
    type: "message",
    date_unixtime: String(Math.floor(row.timestamp.getTime() / 1000)),
    from: row.speaker,
    from_id: `user-${row.speaker}`,
    text: row.content.trim(),
  }));
  return JSON.stringify({ name: "小满", type: "personal_chat", id: 1, messages }, null, 2);
}

function renderWechatJson(records: FixtureRecord[]): string {
  const rows = textRows(records).map((row) => ({
    sender: row.speaker,
    content: row.content.trim(),
    timestamp: formatShanghai(row.timestamp),
  }));
  return JSON.stringify(rows, null, 2);
}

function renderWechatCsv(records: FixtureRecord[]): string {
  const header = "IsSender,StrContent,StrTime,Type,SubType,NickName";
  const lines = textRows(records).map((row) =>
    [
      row.role === "user" ? "1" : "0",
      csvCell(row.content.trim()),
      csvCell(formatShanghai(row.timestamp)),
      "1",
      "0",
      csvCell(row.speaker),
    ].join(","),
  );
  return [header, ...lines].join("\n");
}

export function renderFixture(records: FixtureRecord[], format: FixtureFormat | string): string {
  switch (format) {
    case "generic-line":
      return renderGenericLine(records);
    case "wechat-txt-2line":
      return renderWechatTxt2Line(records);
    case "wechat-txt-paren":
      return renderWechatTxtParen(records);
    case "wechat-csv":
      return renderWechatCsv(records);
    case "wechat-json":
      return renderWechatJson(records);
    case "qq-txt":
      return renderQqTxt(records);
    case "qq-mht":
      return renderQqMht(records);
    case "telegram-json":
      return renderTelegramJson(records);
    default:
      throw new Error(`renderFixture: format "${format}" is not implemented yet (C1.1)`);
  }
}
