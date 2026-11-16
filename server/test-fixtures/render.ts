/**
 * Renders a fixture log into an on-disk export shape.
 *
 * Unknown formats are a hard error so a caller cannot silently
 * round-trip the wrong thing.
 */
import type { FixtureRecord } from "./xiaoman";
import { formatShanghai } from "./xiaoman";

export type FixtureFormat = "generic-line" | "wechat-txt-2line";

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

export function renderFixture(records: FixtureRecord[], format: FixtureFormat | string): string {
  switch (format) {
    case "generic-line":
      return renderGenericLine(records);
    case "wechat-txt-2line":
      return renderWechatTxt2Line(records);
    default:
      throw new Error(`renderFixture: format "${format}" is not implemented yet (C1.1)`);
  }
}
