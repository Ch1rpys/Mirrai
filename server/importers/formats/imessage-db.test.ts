import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectFormat } from "../detect";
import { importSourceFrom } from "../normalize";
import { parseAttributedBody, parseImessageDb } from "./imessage-db";

const SAMPLE = readFileSync(
  path.resolve(import.meta.dirname, "../../test-fixtures/exports/imessage-db/chat.db"),
);

describe("imessage-db", () => {
  it("reads text, attributedBody, is_from_me, and Apple-epoch dates", async () => {
    const parsed = await parseImessageDb(SAMPLE);
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

  it("pulls UTF-8 out of a typedstream attributedBody blob", () => {
    const payload = Buffer.from("他说：先这样", "utf8");
    const blob = Buffer.concat([Buffer.from("streamtyped\0NSString\0+"), Buffer.from([payload.length]), payload]);
    expect(parseAttributedBody(blob)).toBe("他说：先这样");
  });

  it("is detected from its sample with confidence of at least 0.6", () => {
    const hits = detectFormat(importSourceFrom("chat.db", SAMPLE));
    expect(hits[0]?.id).toBe("imessage-db");
    expect(hits[0]?.confidence).toBeGreaterThanOrEqual(0.6);
  });
});
