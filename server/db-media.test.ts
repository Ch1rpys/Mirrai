import { describe, expect, it } from "vitest";
import {
  countMedia,
  createPersona,
  createPersonaFile,
  deletePersona,
  deletePersonaFile,
  listMedia,
  setMediaTranscript,
  upsertMedia,
} from "./db";

/**
 * The media table.
 *
 * The identity is the content hash: importing the same export twice
 * registers one row, not two. And a media row belongs to the source
 * file it came from, so deleting that source takes the rows with it.
 */

const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)("the media table", () => {
  it("keeps one row per file and can add the words later", async () => {
    const userId = 9_950_000 + Math.floor(Math.random() * 10_000);
    const personaId = await createPersona({ userId, name: "media" });
    try {
      const data = {
        userId,
        personaId,
        kind: "voice",
        fileKey: `personas/${userId}/${personaId}/imports/1/a.ogg`,
        mime: "audio/ogg",
        bytes: 120,
        hash: "a".repeat(64),
        at: new Date("2022-03-01T12:00:00Z"),
        recordId: 100,
        fileId: 1,
        fromThem: true,
        durationSec: 12,
      };
      await upsertMedia(data);
      await upsertMedia({ ...data, bytes: 121 });

      const rows = await listMedia(personaId, userId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.bytes).toBe(121);
      expect(await countMedia(personaId, userId, "voice")).toBe(1);
      expect(await countMedia(personaId, userId, "photo")).toBe(0);

      await setMediaTranscript(rows[0]!.id, userId, "刚下课", "whisper-cpp");
      const updated = await listMedia(personaId, userId);
      expect(updated[0]?.transcript).toBe("刚下课");
      expect(updated[0]?.transcriptEngine).toBe("whisper-cpp");

      // Somebody else's id sees nothing.
      const other = await listMedia(personaId, userId + 1);
      expect(other).toHaveLength(0);
    } finally {
      await deletePersona(personaId, userId);
    }
  });

  it("removes the media rows when the source file is deleted", async () => {
    const userId = 9_960_000 + Math.floor(Math.random() * 10_000);
    const personaId = await createPersona({ userId, name: "media-source" });
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
      for (const [index, hash] of ["b", "c"].entries()) {
        await upsertMedia({
          userId,
          personaId,
          kind: "voice",
          fileKey: `personas/${userId}/${personaId}/imports/${fileId}/${index}.ogg`,
          hash: hash.repeat(64),
          fileId,
          recordId: index + 1,
        });
      }
      expect(await countMedia(personaId, userId)).toBe(2);

      await deletePersonaFile(fileId, userId);

      expect(await countMedia(personaId, userId)).toBe(0);
    } finally {
      await deletePersona(personaId, userId);
    }
  });

  it("takes the media rows with the persona", async () => {
    const userId = 9_970_000 + Math.floor(Math.random() * 10_000);
    const personaId = await createPersona({ userId, name: "media-persona" });
    await upsertMedia({
      userId,
      personaId,
      kind: "photo",
      fileKey: `personas/${userId}/${personaId}/imports/1/p.jpg`,
      hash: "d".repeat(64),
      fileId: 1,
    });
    await deletePersona(personaId, userId);
    expect(await countMedia(personaId, userId)).toBe(0);
  });
});
