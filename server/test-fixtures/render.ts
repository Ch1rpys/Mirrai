/**
 * Renders a fixture log into an on-disk export shape.
 *
 * WP0 only implements `generic-line`. The other formats arrive with the
 * importers in C1.1; until then an unknown format is a hard error so a
 * caller cannot silently round-trip the wrong thing.
 */
import type { FixtureRecord } from "./xiaoman";
import { formatShanghai } from "./xiaoman";

export type FixtureFormat = "generic-line";

export function renderFixture(records: FixtureRecord[], format: FixtureFormat | string): string {
  if (format !== "generic-line") {
    throw new Error(`renderFixture: format "${format}" is not implemented yet (C1.1)`);
  }
  const lines: string[] = [];
  for (const row of records) {
    if (row.kind !== "text") continue;
    const content = row.content.trim();
    if (!content) continue;
    lines.push(`[${formatShanghai(row.timestamp)}] ${row.speaker}：${content}`);
  }
  return lines.join("\n");
}
