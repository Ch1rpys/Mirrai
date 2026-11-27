import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { measureUploads } from "./system/diagnose-deps";

/**
 * The uploads number is capped at fifty thousand files (C8.12).
 *
 * Walking a million files to print a size would make the one-click
 * diagnosis itself the slow thing it is meant to find, so the cap is
 * part of the answer and is reported as such.
 */
describe("the uploads measurement (C8.12)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "mirrai-uploads-cap-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("counts the files, bytes and the cap", async () => {
    mkdirSync(path.join(dir, "a"));
    writeFileSync(path.join(dir, "a", "one.txt"), "x");
    writeFileSync(path.join(dir, "a", "two.txt"), "yy");
    writeFileSync(path.join(dir, "three.txt"), "zzz");
    const full = await measureUploads(dir);
    expect(full).toEqual({ files: 3, bytes: 6, capped: false });

    const capped = await measureUploads(dir, 2);
    expect(capped.files).toBe(2);
    expect(capped.capped).toBe(true);
  });
});
