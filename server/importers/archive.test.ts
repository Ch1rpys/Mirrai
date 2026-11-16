import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { unpackZip } from "./archive";
import { detectFormat } from "./detect";
import { importSourceFrom } from "./normalize";

const CHAT = [
  "[2022-03-01 20:00:00] 小满：在吗",
  "[2022-03-01 20:00:05] 阿树：在的",
].join("\n");

function zipOf(files: Record<string, string | Uint8Array>): Uint8Array {
  const data: Record<string, Uint8Array> = {};
  for (const [name, body] of Object.entries(files)) {
    data[name] = typeof body === "string" ? strToU8(body) : body;
  }
  return zipSync(data);
}

const dirs: string[] = [];

async function destDir(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "mirrai-archive-"));
  dirs.push(root);
  return path.join(root, "out");
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("unpackZip", () => {
  it("extracts a chat file and a picture, and skips a non-whitelist name", async () => {
    const dest = await destDir();
    const result = await unpackZip(
      zipOf({
        "chat.txt": CHAT,
        "photos/pic.jpg": new Uint8Array([0xff, 0xd8, 0xff]),
        "secret.exe": "MZ",
      }),
      dest,
    );

    expect(result.ok).toBe(true);
    expect(result.chatFiles.map((row) => row.relativePath)).toEqual(["chat.txt"]);
    expect(result.mediaFiles.map((row) => row.relativePath)).toEqual(["photos/pic.jpg"]);
    expect(result.skipped).toBe(1);
    expect(result.warnings.some((row) => row.code === "zip-skipped-ext")).toBe(true);
    expect(existsSync(path.join(dest, "secret.exe"))).toBe(false);
    expect(await readFile(path.join(dest, "chat.txt"), "utf8")).toBe(CHAT);
    expect(await readFile(path.join(dest, "photos/pic.jpg"))).toEqual(
      Buffer.from([0xff, 0xd8, 0xff]),
    );
  });

  it("skips ../evil.txt and does not write it outside the destination", async () => {
    const dest = await destDir();
    const parent = path.dirname(dest);
    const result = await unpackZip(
      zipOf({
        "chat.txt": CHAT,
        "../evil.txt": "nope",
        "/abs.txt": "nope",
        "nested/../outside.txt": "nope",
      }),
      dest,
    );

    expect(result.ok).toBe(true);
    expect(result.chatFiles.map((row) => row.relativePath)).toEqual(["chat.txt"]);
    expect(result.skipped).toBeGreaterThanOrEqual(2);
    expect(result.warnings.some((row) => row.code === "zip-slip")).toBe(true);
    expect(existsSync(path.join(parent, "evil.txt"))).toBe(false);
    expect(existsSync(path.join(dest, "evil.txt"))).toBe(false);
    expect(existsSync(path.join(dest, "abs.txt"))).toBe(false);
    expect(existsSync(path.join(parent, "outside.txt"))).toBe(false);
    expect((await readdir(parent)).sort()).toEqual(["out"]);
  });

  it("rejects a zip that exceeds the entry cap and clears the destination", async () => {
    const dest = await destDir();
    const files: Record<string, string> = {};
    for (let i = 0; i < 4; i++) files[`chat-${i}.txt`] = CHAT;
    const result = await unpackZip(zipOf(files), dest, { maxEntries: 3 });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("too-many-entries");
    expect(result.chatFiles).toEqual([]);
    expect(existsSync(dest)).toBe(false);
  });

  it("skips a non-whitelist extension without writing it", async () => {
    const dest = await destDir();
    const result = await unpackZip(
      zipOf({
        "notes.md": "# hi",
        "payload.bin": "xx",
        "chat.csv": "Time,Speaker,Content\n2022-03-01 20:00:00,小满,在吗\n",
      }),
      dest,
    );

    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(2);
    expect(result.chatFiles.map((row) => row.relativePath)).toEqual(["chat.csv"]);
    expect(existsSync(path.join(dest, "notes.md"))).toBe(false);
    expect(existsSync(path.join(dest, "payload.bin"))).toBe(false);
  });

  it("leaves a chat file that detectFormat can read as generic-line", async () => {
    const dest = await destDir();
    const result = await unpackZip(zipOf({ "export/chat.txt": CHAT }), dest);
    expect(result.ok).toBe(true);
    const bytes = await readFile(result.chatFiles[0].absPath);
    const detected = detectFormat(importSourceFrom("chat.txt", bytes));
    expect(detected[0]?.id).toBe("generic-line");
    expect(detected[0]?.confidence).toBeGreaterThanOrEqual(0.6);
  });
});
