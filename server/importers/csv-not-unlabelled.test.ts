/**
 * A WeChat CSV is not an unlabelled dump of cells.
 *
 * The old generic-line path stored header names and left every row
 * without a role. Distillation then treated the whole file as one
 * unnamed speaker. This file is the A3 check: after the wechat-csv
 * importer, every row has a side, and the header is not a record.
 */
import { describe, expect, it } from "vitest";
import { buildXiaomanRecords } from "../test-fixtures/xiaoman";
import { renderFixture } from "../test-fixtures/render";
import { importSourceFrom } from "./normalize";
import { importerById } from "./registry";
import { assignRoles, guessRoles } from "./roles";

describe("a wechat csv is not unlabelled text", () => {
  it("gives every row a role and does not store the header", async () => {
    const text = renderFixture(buildXiaomanRecords(), "wechat-csv");
    const importer = importerById("wechat-csv");
    expect(importer).toBeDefined();
    const parsed = await importer!.parse(
      importSourceFrom("chat.csv", Buffer.from(text, "utf8"), text),
      {},
    );
    const mapping = guessRoles(
      parsed.speakers.map((row) => row.name),
      {},
      parsed.records,
    );
    expect(mapping).not.toBeNull();
    const assigned = assignRoles(parsed.records, mapping!);
    expect(assigned.length).toBeGreaterThan(0);
    for (const row of assigned) {
      expect(row.role === "user" || row.role === "assistant").toBe(true);
      expect(row.content).not.toMatch(/IsSender|StrContent|StrTime/i);
      expect(row.lineNo).toBeGreaterThan(1);
    }
  });
});
