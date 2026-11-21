import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { detectFormat, pickDetectedFormat } from "../detect";
import { importSourceFrom } from "../normalize";
import { monologueImporter, parseMonologue, parseMonologueDateLine, splitMonologue } from "./monologue";

const SAMPLE = readFileSync(
  path.resolve(import.meta.dirname, "../../test-fixtures/exports/monologue/sample.txt"),
  "utf8",
);

function source(text: string, name = "diary.txt") {
  return importSourceFrom(name, Buffer.from(text, "utf8"), text);
}

describe("the monologue importer (C1.8)", () => {
  it("turns each paragraph into one written record", async () => {
    const parsed = await parseMonologue(SAMPLE, { timeZone: "Asia/Shanghai" });
    expect(parsed.records).toHaveLength(3);
    for (const record of parsed.records) {
      expect(record).toMatchObject({
        speaker: "them",
        kind: "text",
        meta: { register: "written" },
      });
      expect(record.timestamp).toBeInstanceOf(Date);
    }
    // The date lines date the paragraphs; they are not records themselves.
    expect(parsed.records[0]?.timestamp?.toISOString()).toBe("2023-05-01T04:00:00.000Z");
    expect(parsed.records[1]?.timestamp?.toISOString()).toBe("2023-05-02T04:00:00.000Z");
    expect(parsed.records[2]?.timestamp?.toISOString()).toBe("2023-05-02T04:00:00.000Z");
    expect(parsed.records[0]?.content).toContain("今天去了海边");
  });

  it("dates nothing when the file has no date lines", async () => {
    const parsed = await parseMonologue("一段日记。\n\n又一段。", {
      timeZone: "Asia/Shanghai",
    });
    expect(parsed.records).toHaveLength(2);
    expect(parsed.records.map((row) => row.timestamp)).toEqual([null, null]);
    expect(parsed.records.every((row) => row.meta?.register === "written")).toBe(true);
  });

  it("reads the common date-line shapes", () => {
    expect(parseMonologueDateLine("2023-05-01")).toMatchObject({ kind: "date" });
    expect(parseMonologueDateLine("2023/5/1")).toMatchObject({ kind: "date" });
    expect(parseMonologueDateLine("2023年5月1日")).toMatchObject({ kind: "date" });
    expect(parseMonologueDateLine("2023年5月1日 星期一")).toMatchObject({ kind: "date" });
    expect(parseMonologueDateLine("2023年")).toMatchObject({ kind: "year", year: 2023 });
    expect(parseMonologueDateLine("5月1日")).toMatchObject({
      kind: "monthDay",
      month: 5,
      day: 1,
    });
    expect(parseMonologueDateLine("今天去了海边。")).toBeNull();
    expect(parseMonologueDateLine("2023年13月1日")).toBeNull();
  });

  it("takes the year for a month-day line from the last full date", () => {
    const paragraphs = splitMonologue(
      "2022年12月31日\n\n第一段。\n\n1月2日\n\n第二段。",
      { timeZone: "Asia/Shanghai" },
    );
    expect(paragraphs.map((row) => row.text)).toEqual(["第一段。", "第二段。"]);
    expect(paragraphs[0]?.timestamp?.toISOString()).toBe("2022-12-31T04:00:00.000Z");
    expect(paragraphs[1]?.timestamp?.toISOString()).toBe("2023-01-02T04:00:00.000Z");
  });

  it("never lets detection claim it as a chat log", () => {
    const hits = detectFormat(source(SAMPLE));
    expect(hits.some((hit) => hit.id === "monologue")).toBe(false);
    expect(pickDetectedFormat(hits)).not.toMatchObject({ id: "monologue" });
    expect(monologueImporter.detect(source(SAMPLE))).toBeNull();
  });

  it("is in the registry, so the wizard can offer it", async () => {
    const { IMPORTERS } = await import("../registry");
    expect(IMPORTERS.map((row) => row.id)).toContain("monologue");
  });
});
