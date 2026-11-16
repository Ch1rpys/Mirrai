import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectFormat, pickDetectedFormat } from "./detect";
import { importSourceFrom } from "./normalize";

const SAMPLE = readFileSync(
  path.resolve(import.meta.dirname, "../test-fixtures/exports/generic-line/sample.txt"),
  "utf8",
);

function source(fileName: string, text: string) {
  return importSourceFrom(fileName, Buffer.from(text, "utf8"), text);
}

describe("detectFormat", () => {
  it("claims the generic-line sample with confidence of at least 0.6", () => {
    const hits = detectFormat(source("chat.txt", SAMPLE));
    expect(hits[0]?.id).toBe("generic-line");
    expect(hits[0]?.confidence).toBeGreaterThanOrEqual(0.6);
    expect(pickDetectedFormat(hits)).toMatchObject({ id: "generic-line" });
  });

  it("claims the wechat-txt-2line sample as itself", () => {
    const sample = readFileSync(
      path.resolve(import.meta.dirname, "../test-fixtures/exports/wechat-txt-2line/sample.txt"),
      "utf8",
    );
    const hits = detectFormat(source("chat.txt", sample));
    expect(hits[0]?.id).toBe("wechat-txt-2line");
    expect(hits[0]?.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("claims the wechat-txt-paren sample as itself", () => {
    const sample = readFileSync(
      path.resolve(import.meta.dirname, "../test-fixtures/exports/wechat-txt-paren/sample.txt"),
      "utf8",
    );
    const hits = detectFormat(source("chat.txt", sample));
    expect(hits[0]?.id).toBe("wechat-txt-paren");
    expect(hits[0]?.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("claims the wechat-csv sample as itself", () => {
    const sample = readFileSync(
      path.resolve(import.meta.dirname, "../test-fixtures/exports/wechat-csv/sample.csv"),
      "utf8",
    );
    const hits = detectFormat(source("chat.csv", sample));
    expect(hits[0]?.id).toBe("wechat-csv");
    expect(hits[0]?.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("claims the wechat-json sample as itself", () => {
    const sample = readFileSync(
      path.resolve(import.meta.dirname, "../test-fixtures/exports/wechat-json/sample.json"),
      "utf8",
    );
    const hits = detectFormat(source("chat.json", sample));
    expect(hits[0]?.id).toBe("wechat-json");
    expect(hits[0]?.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("claims the qq-mht sample as itself", () => {
    const sample = readFileSync(
      path.resolve(import.meta.dirname, "../test-fixtures/exports/qq-mht/sample.mht"),
      "utf8",
    );
    const hits = detectFormat(source("chat.mht", sample));
    expect(hits[0]?.id).toBe("qq-mht");
    expect(hits[0]?.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("claims the qq-txt sample as itself", () => {
    const sample = readFileSync(
      path.resolve(import.meta.dirname, "../test-fixtures/exports/qq-txt/sample.txt"),
      "utf8",
    );
    const hits = detectFormat(source("chat.txt", sample));
    expect(hits[0]?.id).toBe("qq-txt");
    expect(hits[0]?.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("claims the meta-json sample as itself", () => {
    const sample = readFileSync(
      path.resolve(import.meta.dirname, "../test-fixtures/exports/meta-json/sample.json"),
      "utf8",
    );
    const hits = detectFormat(source("message_1.json", sample));
    expect(hits[0]?.id).toBe("meta-json");
    expect(hits[0]?.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("claims the kakao-txt sample as itself", () => {
    const sample = readFileSync(
      path.resolve(import.meta.dirname, "../test-fixtures/exports/kakao-txt/sample.txt"),
      "utf8",
    );
    const hits = detectFormat(source("chat.txt", sample));
    expect(hits[0]?.id).toBe("kakao-txt");
    expect(hits[0]?.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("claims the line-txt sample as itself", () => {
    const sample = readFileSync(
      path.resolve(import.meta.dirname, "../test-fixtures/exports/line-txt/sample.txt"),
      "utf8",
    );
    const hits = detectFormat(source("chat.txt", sample));
    expect(hits[0]?.id).toBe("line-txt");
    expect(hits[0]?.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("claims the whatsapp-txt sample as itself", () => {
    const sample = readFileSync(
      path.resolve(import.meta.dirname, "../test-fixtures/exports/whatsapp-txt/sample.txt"),
      "utf8",
    );
    const hits = detectFormat(source("chat.txt", sample));
    expect(hits[0]?.id).toBe("whatsapp-txt");
    expect(hits[0]?.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("claims the telegram-json sample as itself", () => {
    const sample = readFileSync(
      path.resolve(import.meta.dirname, "../test-fixtures/exports/telegram-json/sample.json"),
      "utf8",
    );
    const hits = detectFormat(source("result.json", sample));
    expect(hits[0]?.id).toBe("telegram-json");
    expect(hits[0]?.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("does not claim a prose paragraph", () => {
    const prose = [
      "The evening was quiet.",
      "Nobody spoke for a long time.",
      "A bus went past the window.",
    ].join("\n");
    expect(detectFormat(source("notes.txt", prose))).toEqual([]);
    expect(pickDetectedFormat([])).toBeNull();
  });
});
