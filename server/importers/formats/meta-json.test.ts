import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectFormat } from "../detect";
import { importSourceFrom } from "../normalize";
import { parseMetaJson } from "./meta-json";

const SAMPLE = readFileSync(
  path.resolve(import.meta.dirname, "../../test-fixtures/exports/meta-json/sample.json"),
  "utf8",
);

describe("meta-json", () => {
  it("repairs latin1 mojibake, sorts oldest first, and keeps a photo path", async () => {
    const parsed = await parseMetaJson(SAMPLE);
    expect(parsed.records[0]).toMatchObject({ speaker: "小满", content: "在吗" });
    expect(parsed.records[0].timestamp?.toISOString()).toBe("2022-03-01T12:00:00.000Z");
    expect(parsed.records[1].content).toBe("在的呀\n还没睡");
    expect(parsed.records.find((row) => row.content === "他说：先这样")).toBeTruthy();
    expect(parsed.records.at(-1)?.kind).toBe("image");
    expect(parsed.records.at(-1)?.meta).toEqual({ path: "messages/inbox/photos/1.jpg" });
  });

  it("is detected from its sample with confidence of at least 0.6", () => {
    const hits = detectFormat(importSourceFrom("message_1.json", Buffer.from(SAMPLE, "utf8"), SAMPLE));
    expect(hits[0]?.id).toBe("meta-json");
    expect(hits[0]?.confidence).toBeGreaterThanOrEqual(0.6);
  });
});
