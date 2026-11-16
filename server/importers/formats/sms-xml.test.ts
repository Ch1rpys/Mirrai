import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectFormat } from "../detect";
import { importSourceFrom } from "../normalize";
import { parseSmsXml } from "./sms-xml";

const SAMPLE = readFileSync(
  path.resolve(import.meta.dirname, "../../test-fixtures/exports/sms-xml/sample.xml"),
  "utf8",
);

describe("sms-xml", () => {
  it("reads type 1 as received, type 2 as sent, and restores a newline in body", async () => {
    const parsed = await parseSmsXml(SAMPLE);
    expect(parsed.records[0]).toMatchObject({
      speaker: "小满",
      fromMe: false,
      content: "在吗",
    });
    expect(parsed.records[0].timestamp?.toISOString()).toBe("2022-03-01T12:00:00.000Z");
    expect(parsed.records[1]).toMatchObject({
      speaker: "阿树",
      fromMe: true,
      content: "在的呀\n还没睡",
    });
    expect(parsed.records.find((row) => row.content === "他说：先这样")).toBeTruthy();
  });

  it("is detected from its sample with confidence of at least 0.6", () => {
    const hits = detectFormat(importSourceFrom("sms.xml", Buffer.from(SAMPLE, "utf8"), SAMPLE));
    expect(hits[0]?.id).toBe("sms-xml");
    expect(hits[0]?.confidence).toBeGreaterThanOrEqual(0.6);
  });
});
