import { describe, expect, it } from "vitest";
import {
  countMedia,
  createPersona,
  createPersonaFile,
  deletePersona,
  deletePersonaFile,
  getPersonaSettings,
  listMedia,
  setMediaTranscript,
  setPersonaBackground,
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

  it("does not clear metadata that a later upsert omits", async () => {
    const userId = 9_955_000 + Math.floor(Math.random() * 10_000);
    const personaId = await createPersona({ userId, name: "media-metadata" });
    try {
      const at = new Date("2022-03-01T12:00:00Z");
      await upsertMedia({
        userId,
        personaId,
        kind: "video",
        fileKey: `personas/${userId}/${personaId}/v.mp4`,
        mime: "video/mp4",
        bytes: 100,
        hash: "d".repeat(64),
        at,
        durationSec: 5,
        width: 640,
        height: 360,
      });
      const second = await upsertMedia({
        userId,
        personaId,
        kind: "video",
        fileKey: `personas/${userId}/${personaId}/v.mp4`,
        bytes: 101,
        hash: "d".repeat(64),
      });
      expect(second.bytes).toBe(101);
      expect(second.at?.toISOString()).toBe(at.toISOString());
      expect(second.durationSec).toBe(5);
      expect(second.width).toBe(640);
      expect(second.height).toBe(360);
      expect(second.mime).toBe("video/mp4");
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

  it("removes a standalone uploaded photo by its file key", async () => {
    const userId = 9_965_000 + Math.floor(Math.random() * 10_000);
    const personaId = await createPersona({ userId, name: "standalone-photo" });
    try {
      const fileId = await createPersonaFile({
        personaId,
        userId,
        fileType: "image",
        originalName: "a.jpg",
        fileKey: `personas/${userId}/${personaId}/a.jpg`,
        fileUrl: `/uploads/personas/${userId}/${personaId}/a.jpg`,
        fileSize: 10,
      });
      await upsertMedia({
        userId,
        personaId,
        kind: "photo",
        fileKey: `personas/${userId}/${personaId}/a.jpg`,
        hash: "7".repeat(64),
        // The row was registered before its fileId was stored.
        fileId: null,
      });
      expect(await countMedia(personaId, userId, "photo")).toBe(1);

      await deletePersonaFile(fileId, userId);

      expect(await countMedia(personaId, userId, "photo")).toBe(0);
    } finally {
      await deletePersona(personaId, userId);
    }
  });

  it("creates a skin with a default theme when only a background is written", async () => {
    const userId = 9_968_000 + Math.floor(Math.random() * 10_000);
    const personaId = await createPersona({ userId, name: "background" });
    try {
      await setPersonaBackground(personaId, userId, "/uploads/personas/bg.png");
      const settings = await getPersonaSettings(personaId, userId);
      expect(settings?.skin).toEqual({
        theme: "classic",
        background: "/uploads/personas/bg.png",
      });
    } finally {
      await deletePersona(personaId, userId);
    }
  });

  it("removes the background key when the picture is cleared", async () => {
    const userId = 9_969_000 + Math.floor(Math.random() * 10_000);
    const personaId = await createPersona({ userId, name: "background-cleared" });
    try {
      await setPersonaBackground(personaId, userId, "/uploads/personas/bg.png");
      await setPersonaBackground(personaId, userId, null);
      const settings = await getPersonaSettings(personaId, userId);
      expect(settings?.skin).toEqual({ theme: "classic" });
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
