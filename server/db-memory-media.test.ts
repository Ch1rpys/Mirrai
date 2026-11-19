import { describe, expect, it } from "vitest";
import {
  createMemory,
  createPersona,
  createPersonaFile,
  deletePersona,
  deletePersonaFile,
  linkMemoryMedia,
  listMemoryMedia,
  unlinkMemoryMedia,
  upsertMedia,
} from "./db";

/**
 * The memory_media links.
 *
 * A link is private to its owner, a second link of the same pair does
 * not duplicate, and a photo or memory that goes away does not leave a
 * row pointing at nothing.
 */

const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)("photos attached to memories", () => {
  it("keeps one link per pair and only for the owner", async () => {
    const userId = 9_980_000 + Math.floor(Math.random() * 10_000);
    const personaId = await createPersona({ userId, name: "photo-memory" });
    try {
      const memoryId = await createMemory({
        personaId,
        userId,
        title: "第一次见面",
        date: "2022-04-02",
      });
      const mediaId = (
        await upsertMedia({
          userId,
          personaId,
          kind: "photo",
          fileKey: `personas/${userId}/${personaId}/imports/1/a.jpg`,
          hash: "e".repeat(64),
          at: new Date("2022-04-02T04:00:00Z"),
          width: 4,
          height: 4,
        })
      ).id;

      await linkMemoryMedia({ userId, personaId, memoryId, mediaId });
      await linkMemoryMedia({ userId, personaId, memoryId, mediaId });

      const rows = await listMemoryMedia(memoryId, userId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.mediaId).toBe(mediaId);
      expect(rows[0]?.fileKey).toBe(`personas/${userId}/${personaId}/imports/1/a.jpg`);

      // Somebody else sees no link and cannot remove it.
      expect(await listMemoryMedia(memoryId, userId + 1)).toHaveLength(0);
      expect(await unlinkMemoryMedia(memoryId, mediaId, userId + 1)).toBe(false);
      expect(await listMemoryMedia(memoryId, userId)).toHaveLength(1);
    } finally {
      await deletePersona(personaId, userId);
    }
  });

  it("removes the links when the source file is deleted", async () => {
    const userId = 9_990_000 + Math.floor(Math.random() * 10_000);
    const personaId = await createPersona({ userId, name: "photo-source" });
    try {
      const fileId = await createPersonaFile({
        personaId,
        userId,
        fileType: "chat_txt",
        originalName: "chat.zip",
        fileKey: `personas/${userId}/${personaId}/chat.zip`,
        fileUrl: `/uploads/personas/${userId}/${personaId}/chat.zip`,
        fileSize: 12,
      });
      const memoryId = await createMemory({ personaId, userId, title: "那天" });
      const mediaId = (
        await upsertMedia({
          userId,
          personaId,
          kind: "photo",
          fileKey: `personas/${userId}/${personaId}/imports/${fileId}/a.jpg`,
          hash: "f".repeat(64),
          fileId,
        })
      ).id;
      await linkMemoryMedia({ userId, personaId, memoryId, mediaId });
      expect(await listMemoryMedia(memoryId, userId)).toHaveLength(1);

      await deletePersonaFile(fileId, userId);

      expect(await listMemoryMedia(memoryId, userId)).toHaveLength(0);
    } finally {
      await deletePersona(personaId, userId);
    }
  });

  it("removes the links with the persona", async () => {
    const userId = 9_995_000 + Math.floor(Math.random() * 10_000);
    const personaId = await createPersona({ userId, name: "photo-persona" });
    const memoryId = await createMemory({ personaId, userId, title: "那天" });
    const mediaId = (
      await upsertMedia({
        userId,
        personaId,
        kind: "photo",
        fileKey: `personas/${userId}/${personaId}/a.jpg`,
        hash: "9".repeat(64),
      })
    ).id;
    await linkMemoryMedia({ userId, personaId, memoryId, mediaId });
    await deletePersona(personaId, userId);
    expect(await listMemoryMedia(memoryId, userId)).toHaveLength(0);
  });
});
