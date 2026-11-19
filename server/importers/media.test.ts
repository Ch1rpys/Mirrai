import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Registering the recordings of an import.
 *
 * The files stay where the upload put them; the row carries the hash
 * of the content, so a second import of the same export updates one
 * row instead of adding another. The database test asserts the "one
 * row" part; this one asserts what is written into it.
 */

const uploadRoot = vi.hoisted(
  () => `/tmp/mirrai-media-test-${Math.random().toString(36).slice(2)}`,
);
const db = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  upserted: [] as Array<Record<string, unknown>>,
}));

vi.mock("../_core/env", () => ({ ENV: { uploadDir: uploadRoot } }));
vi.mock("../db", () => ({
  iterateRecords: async function* () {
    for (const row of db.rows) yield row;
  },
  upsertMedia: async (data: Record<string, unknown>) => {
    db.upserted.push(data);
    return data;
  },
}));

import { registerMedia } from "./media";

const importDir = path.join(uploadRoot, "personas", "1", "5", "imports", "9");

function row(name: string, overrides: Record<string, unknown> = {}) {
  return {
    id: 100 + name.length,
    role: "assistant",
    kind: "voice",
    content: "[voice:12]",
    timestamp: new Date("2022-03-01T12:00:00Z"),
    createdAt: new Date("2022-03-01T12:00:00Z"),
    fileId: 9,
    meta: { path: name, durationSec: 12 },
    ...overrides,
  };
}

describe("registering media", () => {
  afterAll(async () => {
    await rm(uploadRoot, { recursive: true, force: true });
  });

  it("registers the three voice files of an import", async () => {
    await mkdir(importDir, { recursive: true });
    for (const name of ["a.ogg", "b.ogg", "c.ogg"]) {
      await writeFile(path.join(importDir, name), `bytes of ${name}`);
    }
    db.rows = [
      row("a.ogg", { id: 1, meta: { path: "a.ogg", durationSec: 12, transcript: "刚下课" } }),
      row("b.ogg", { id: 2, role: "user", meta: { path: "b.ogg", durationSec: 5 } }),
      row("c.ogg", { id: 3, meta: { path: "c.ogg" } }),
    ];
    db.upserted = [];

    const result = await registerMedia({ personaId: 5, userId: 1 });

    expect(result.registered).toBe(3);
    expect(db.upserted).toHaveLength(3);
    const first = db.upserted[0]!;
    expect(first.kind).toBe("voice");
    expect(first.fromThem).toBe(true);
    expect(first.durationSec).toBe(12);
    expect(first.transcript).toBe("刚下课");
    expect(first.recordId).toBe(1);
    expect(first.fileId).toBe(9);
    expect(String(first.fileKey)).toBe("personas/1/5/imports/9/a.ogg");
    expect(first.mime).toBe("audio/ogg");
    expect(String(first.hash)).toMatch(/^[0-9a-f]{64}$/);
    expect(db.upserted[1]!.fromThem).toBe(false);
    expect(db.upserted[2]!.durationSec).toBeNull();
  });

  it("gives the same file the same hash, so an import can update one row", async () => {
    db.rows = [row("a.ogg", { id: 1 })];
    db.upserted = [];
    await registerMedia({ personaId: 5, userId: 1 });
    const first = db.upserted[0]!;
    db.upserted = [];
    await registerMedia({ personaId: 5, userId: 1 });
    const second = db.upserted[0]!;
    expect(second.hash).toBe(first.hash);
    expect(second.fileKey).toBe(first.fileKey);
  });

  it("skips a row whose file the export did not carry", async () => {
    db.rows = [row("missing.ogg", { id: 7 })];
    db.upserted = [];
    const result = await registerMedia({ personaId: 5, userId: 1 });
    expect(result.registered).toBe(0);
    expect(result.skipped).toBe(1);
    expect(db.upserted).toHaveLength(0);
  });

  it("registers only the named upload when one is given", async () => {
    db.rows = [
      row("a.ogg", { id: 1 }),
      row("b.ogg", { id: 2, fileId: 10 }),
    ];
    db.upserted = [];
    const result = await registerMedia({ personaId: 5, userId: 1, fileId: 9 });
    expect(result.total).toBe(1);
    expect(db.upserted).toHaveLength(1);
  });

  it("maps a picture and a video to their own kinds", async () => {
    await writeFile(path.join(importDir, "p.jpg"), "jpeg");
    db.rows = [
      row("p.jpg", { id: 4, kind: "image", content: "[image]", meta: { path: "p.jpg" } }),
      row("c.ogg", { id: 5, kind: "video", content: "[video:9]", meta: { path: "c.ogg" } }),
    ];
    db.upserted = [];
    await registerMedia({ personaId: 5, userId: 1 });
    expect(db.upserted.map((entry) => entry.kind)).toEqual(["photo", "video"]);
  });
});
