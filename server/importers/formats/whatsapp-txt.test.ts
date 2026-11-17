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
    expect(parsed.records.find((row) => row.content === "好")?.timestamp?.toISOString()).toBe(
      "2022-03-01T12:00:00.000Z",
    );
    expect(parsed.records.find((row) => row.kind === "image")?.meta).toEqual({
      path: "IMG-20220302-WA0001.jpg",
    });
    expect(parsed.records.find((row) => row.kind === "file")?.content).toBe("[file:note.txt]");
    expect(parsed.records.find((row) => row.kind === "system")?.content).toMatch(/encrypted/);
  });

  it("reads an Android M/D/YY file as month-first when no day is past 12", async () => {
    const parsed = await parseWhatsappTxt(
      "3/1/22, 8:05:09 PM - 小满: hello\n3/5/22, 9:00 AM - 阿树: morning",
      { timeZone: "Asia/Shanghai" },
    );
    expect(parsed.records.map((row) => row.timestamp?.toISOString())).toEqual([
      "2022-03-01T12:05:09.000Z",
      "2022-03-05T01:00:00.000Z",
    ]);
  });

  it("keeps day-first once a date in the file proves it", async () => {
    const parsed = await parseWhatsappTxt(
      "1/3/22, 20:00 - 小满: early\n13/3/22, 20:00 - 小满: later",
      { timeZone: "Asia/Shanghai" },
    );
    expect(parsed.records.map((row) => row.timestamp?.toISOString())).toEqual([
      "2022-03-01T12:00:00.000Z",
      "2022-03-13T12:00:00.000Z",
    ]);
  });

  it("reads a short Android date as month-first beside a year-first iOS line", async () => {
    const parsed = await parseWhatsappTxt(
      "[2022/3/1, 20:00:00] 小满: ios\n3/1/22, 20:05 - 阿树: android",
      { timeZone: "Asia/Shanghai" },
    );
    expect(parsed.records.map((row) => row.timestamp?.toISOString())).toEqual([
      "2022-03-01T12:00:00.000Z",
      "2022-03-01T12:05:00.000Z",
    ]);
  });

  it("is detected from its sample with confidence of at least 0.6", () => {
    const hits = detectFormat(importSourceFrom("chat.txt", Buffer.from(SAMPLE, "utf8"), SAMPLE));
    expect(hits[0]?.id).toBe("whatsapp-txt");
    expect(hits[0]?.confidence).toBeGreaterThanOrEqual(0.6);
  });
});
