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
  | "wechat-json";

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
    default:
      throw new Error(`renderFixture: format "${format}" is not implemented yet (C1.1)`);
  }
}
