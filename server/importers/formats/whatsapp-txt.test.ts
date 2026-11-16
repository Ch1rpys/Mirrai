import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectFormat } from "../detect";
import { importSourceFrom } from "../normalize";
import { parseWhatsappTxt } from "./whatsapp-txt";

const SAMPLE = readFileSync(
  path.resolve(import.meta.dirname, "../../test-fixtures/exports/whatsapp-txt/sample.txt"),
  "utf8",
);

describe("whatsapp-txt", () => {
  it("reads iOS brackets, an Android dash line, attachments, and a system line", async () => {
    const parsed = await parseWhatsappTxt(SAMPLE, { timeZone: "Asia/Shanghai" });
    expect(parsed.records[0]).toMatchObject({
      speaker: "小满",
      content: "在吗\n还是说已经睡了",
    });
    expect(parsed.records[0].timestamp?.toISOString()).toBe("2022-03-01T12:00:00.000Z");
    expect(parsed.records.find((row) => row.content === "他说：先这样")?.timestamp?.toISOString()).toBe(
      "2022-03-01T12:00:12.000Z",
    );
    expect(parsed.records.find((row) => row.kind === "image")?.meta).toEqual({
      path: "IMG-20220302-WA0001.jpg",
    });
    expect(parsed.records.find((row) => row.kind === "file")?.content).toBe("[file:note.txt]");
    expect(parsed.records.find((row) => row.kind === "system")?.content).toMatch(/encrypted/);
  });

  it("is detected from its sample with confidence of at least 0.6", () => {
    const hits = detectFormat(importSourceFrom("chat.txt", Buffer.from(SAMPLE, "utf8"), SAMPLE));
    expect(hits[0]?.id).toBe("whatsapp-txt");
    expect(hits[0]?.confidence).toBeGreaterThanOrEqual(0.6);
  });
});
