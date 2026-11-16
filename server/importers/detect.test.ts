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
