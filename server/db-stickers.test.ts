import { afterAll, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import {
  countStickers,
  createPersona,
  purgePersona,
  listEnabledStickers,
  listStickers,
  setStickerEnabled,
  upsertSticker,
} from "./db";
import { storagePut } from "./storage";

/**
 * The sticker table.
 *
 * The key is what makes two rows the same sticker — a second import
 * must update the counts, not add a row. And deleting the persona has
 * to take both the rows and the copied pictures: the copies exist so
 * the library outlives the import, which means nothing else points at
 * them.
 */

const uploadRoot = vi.hoisted(() => {
  const dir = `/tmp/mirrai-db-stickers-${Math.random().toString(36).slice(2)}`;
  process.env.UPLOAD_DIR = dir;
  return dir;
});

describe.skipIf(!process.env.DATABASE_URL)("the sticker table", () => {
  afterAll(async () => {
    await rm(uploadRoot, { recursive: true, force: true });
  });

  it("keeps one row per key and only lists the enabled ones", async () => {
    const userId = 9_930_000 + Math.floor(Math.random() * 10_000);
    const personaId = await createPersona({ userId, name: "stickers" });
    try {
      const base = {
        userId,
        personaId,
        label: "狗狗探头",
        firstUsedAt: new Date("2022-03-01T12:00:00Z"),
        lastUsedAt: new Date("2022-03-01T12:00:00Z"),
      };
      await upsertSticker({ ...base, key: "label:狗狗探头", usesByThem: 3, usesByMe: 1 });
      await upsertSticker({ ...base, key: "label:狗狗探头", usesByThem: 12, usesByMe: 2 });

      const rows = await listStickers(personaId, userId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.usesByThem).toBe(12);
      expect(rows[0]?.usesByMe).toBe(2);

      await setStickerEnabled(personaId, userId, rows[0]!.id, false);
      expect(await listEnabledStickers(personaId, userId)).toHaveLength(0);
      expect(await countStickers(personaId, userId)).toBe(1);
    } finally {
      await purgePersona(personaId, userId);
    }
  });

  it("takes the copied picture with the persona", async () => {
    const userId = 9_940_000 + Math.floor(Math.random() * 10_000);
    const personaId = await createPersona({ userId, name: "stickers-with-picture" });
    try {
      const fileKey = `personas/${userId}/${personaId}/stickers/abc.png`;
      await storagePut(fileKey, Buffer.from("png bytes"), "image/png");
      await upsertSticker({
        userId,
        personaId,
        key: "abc",
        label: "猫猫叹气",
        fileKey,
        mime: "image/png",
        usesByThem: 4,
        usesByMe: 0,
      });
      expect(existsSync(`${uploadRoot}/${fileKey}`)).toBe(true);

      await purgePersona(personaId, userId);

      expect(await countStickers(personaId, userId)).toBe(0);
      expect(existsSync(`${uploadRoot}/${fileKey}`)).toBe(false);
    } finally {
      await purgePersona(personaId, userId).catch(() => undefined);
    }
  });
});
