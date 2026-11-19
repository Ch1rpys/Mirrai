import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildXiaomanRecords } from "../test-fixtures/xiaoman";

/**
 * The sticker library built from a record.
 *
 * The fixture has two stickers, and every one of them was sent by the
 * persona — so the library must come out with two rows and the counts
 * the record has. The image is copied out of the import directory, and
 * a sticker the export only named keeps its name.
 */

const uploadRoot = vi.hoisted(
  () => `/tmp/mirrai-stickers-test-${Math.random().toString(36).slice(2)}`,
);
const db = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  upserted: [] as Array<Record<string, unknown>>,
  listed: [] as Array<Record<string, unknown>>,
}));

vi.mock("../_core/env", () => ({ ENV: { uploadDir: uploadRoot } }));
vi.mock("../db", () => ({
  iterateRecords: async function* () {
    for (const row of db.rows) yield row;
  },
  listStickers: async () => db.listed,
  upsertSticker: async (data: Record<string, unknown>) => {
    db.upserted.push(data);
    return { id: db.upserted.length, ...data };
  },
  countStickers: async () => db.listed.length,
}));

import { groupStickerRows, registerStickers } from "./stickers";

function fixtureRows() {
  return buildXiaomanRecords().map((row) => ({
    role: row.role,
    kind: row.kind,
    content: row.content,
    timestamp: row.timestamp,
    fileId: null,
    meta: row.meta ?? null,
  }));
}

describe("the sticker library", () => {
  afterAll(async () => {
    await rm(uploadRoot, { recursive: true, force: true });
  });

  it("registers the two stickers the fixture uses, with the counts it has", async () => {
    db.rows = fixtureRows();
    db.upserted = [];
    db.listed = [];

    const result = await registerStickers({ personaId: 5, userId: 1 });

    const labels = db.upserted.map((row) => row.label).sort();
    expect(labels).toEqual(["狗狗探头", "猫猫叹气"]);
    expect(result.registered).toBe(2);

    const fixture = buildXiaomanRecords();
    for (const [label, content] of [
      ["狗狗探头", "[sticker:狗狗探头]"],
      ["猫猫叹气", "[sticker:猫猫叹气]"],
    ] as const) {
      const sentByThem = fixture.filter(
        (row) => row.kind === "sticker" && row.content === content && row.role === "assistant",
      ).length;
      const stored = db.upserted.find((row) => row.label === label);
      expect(stored?.usesByThem).toBe(sentByThem);
      expect(stored?.usesByMe).toBe(0);
      expect(String(stored?.key)).toBe(`label:${label}`);
      expect(stored?.firstUsedAt).toBeInstanceOf(Date);
      expect(stored?.lastUsedAt).toBeInstanceOf(Date);
    }
  });

  it("copies the picture out of the import directory under its hash", async () => {
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from("a tiny sticker"),
    ]);
    const importDir = path.join(uploadRoot, "personas", "1", "5", "imports", "9");
    await mkdir(importDir, { recursive: true });
    await writeFile(path.join(importDir, "peek.png"), png);

    db.rows = [
      {
        role: "assistant",
        kind: "sticker",
        content: "[sticker:狗狗探头]",
        timestamp: new Date("2023-05-01T12:00:00Z"),
        fileId: 9,
        meta: { label: "狗狗探头", path: "peek.png" },
      },
    ];
    db.upserted = [];
    db.listed = [];

    const result = await registerStickers({ personaId: 5, userId: 1 });

    expect(result.copied).toBe(1);
    const stored = db.upserted[0]!;
    expect(String(stored.key)).toMatch(/^[0-9a-f]{32}$/);
    expect(String(stored.fileKey)).toBe(
      `personas/1/5/stickers/${stored.key}.png`,
    );
    expect(stored.mime).toBe("image/png");
    const copy = path.join(uploadRoot, String(stored.fileKey));
    await expect(stat(copy)).resolves.toBeTruthy();
  });

  it("keeps the name when the export did not carry the picture", async () => {
    db.rows = [
      {
        role: "assistant",
        kind: "sticker",
        content: "[sticker:猫猫叹气]",
        timestamp: new Date("2023-05-02T12:00:00Z"),
        fileId: 9,
        meta: { label: "猫猫叹气", path: "missing.png" },
      },
    ];
    db.upserted = [];
    db.listed = [];

    const result = await registerStickers({ personaId: 5, userId: 1 });
    expect(db.upserted[0]?.key).toBe("label:猫猫叹气");
    expect(result.copied).toBe(0);
  });

  it("counts a sticker only from the rows that are stickers", async () => {
    const groups = groupStickerRows([
      { role: "assistant", kind: "text", content: "在的", meta: null },
      { role: "assistant", kind: "sticker", content: "[sticker:狗狗探头]", meta: { label: "狗狗探头" } },
      { role: "user", kind: "sticker", content: "[sticker:狗狗探头]", meta: { label: "狗狗探头" } },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.usesByThem).toBe(1);
    expect(groups[0]?.usesByMe).toBe(1);
  });
});
