import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { BackupFormatError } from "../_core/backup-format";
import {
  PERSONA_BUNDLE_FORMAT,
  PERSONA_BUNDLE_PARTS,
  writePersonaBundle,
} from "../_core/bundle";
import { bundleFileAllowed, importPersonaBundle, removeEmptyParents } from "./bundle";

/**
 * What file entries a persona bundle may carry (C9.5, C9.4 of the manual's
 * C1.1 archive rule).
 *
 * The archive comes from outside the app and its file entries land in the
 * uploads directory, which the browser loads from the app's own origin. A
 * bundle therefore follows the same extension allow-list as an import
 * archive: media only. The rejection happens after unpacking and before
 * any row or file is written, so a refused bundle leaves nothing behind.
 */

const roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "mirrai-bundle-import-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const personaJson = {
  name: "外部包",
  relationshipDesc: null,
  togetherFrom: null,
  togetherTo: null,
  timezone: null,
  characterFamily: null,
  personaData: {},
  settings: {},
};

const fileBody = Buffer.from("<script>document.title='pwned'</script>", "utf-8");

async function writeBundle(
  filePath: string,
  file: { name: string; fileName: string; part: "stickers" | "messages" },
): Promise<void> {
  const row =
    file.part === "stickers"
      ? {
          index: 0,
          key: "evil",
          label: "evil",
          fileName: file.fileName,
          mime: "text/html",
          usesByThem: 0,
          usesByMe: 0,
          enabled: true,
        }
      : {
          oldId: 1,
          oldReplyToId: null,
          mediaFileName: file.fileName,
          role: "assistant",
          content: "x",
          messageType: "image",
          mediaUrl: null,
          mediaDuration: null,
          emotionalState: null,
          channel: "web",
          origin: null,
          metadata: null,
          createdAt: null,
        };
  await writePersonaBundle({
    outPath: filePath,
    entries: [
      {
        name: PERSONA_BUNDLE_PARTS.persona,
        compress: true,
        chunks: async function* () {
          yield Buffer.from(JSON.stringify(personaJson));
        },
      },
      {
        name: file.part === "stickers" ? PERSONA_BUNDLE_PARTS.stickers : PERSONA_BUNDLE_PARTS.messages,
        compress: true,
        chunks: async function* () {
          yield Buffer.from(`${JSON.stringify(row)}\n`);
        },
      },
      {
        name: `files/${file.part === "stickers" ? "stickers" : "messages"}/${file.name}`,
        compress: false,
        chunks: async function* () {
          yield fileBody;
        },
      },
    ],
    manifest: {
      kind: "persona",
      format: PERSONA_BUNDLE_FORMAT,
      createdAt: new Date().toISOString(),
      appVersion: "test",
      source: { personaId: 1, name: "外部包" },
      includes: { memories: false, records: false, conversation: false },
      counts: { records: 0, memories: 0, messages: 0, stickers: 1, media: 0 },
    },
    passphrase: null,
  });
}

describe("bundle file entries", () => {
  it("allows the media kinds the uploads directory serves", () => {
    for (const name of [
      "0-photo.jpg",
      "0-photo.jpeg",
      "0-photo.png",
      "0-sticker.webp",
      "0-note.mp3",
      "0-voice.silk",
      "0-video.mp4",
      "0-video.webm",
    ]) {
      expect(bundleFileAllowed(name), name).toBe(true);
    }
  });

  it("refuses an extension a browser would run", () => {
    for (const name of ["0-evil.html", "0-evil.htm", "0-evil.svg", "0-evil.js", "0-no-extension"]) {
      expect(bundleFileAllowed(name), name).toBe(false);
    }
  });

  it("refuses a bundle whose sticker file is an html page, before it writes anything", async () => {
    const root = tempRoot();
    const bundlePath = path.join(root, "evil.mirrai-persona");
    await writeBundle(bundlePath, { name: "0-evil.html", fileName: "0-evil.html", part: "stickers" });
    /**
     * The importer's staging directory is made with `os.tmpdir()`. Pointing
     * TMPDIR at a fresh directory for this call is what makes "nothing was
     * left behind" a real assertion — reading the folder the bundle lives
     * in never proved anything about staging.
     */
    const stagingRoot = mkdtempSync(path.join(os.tmpdir(), "mirrai-staging-check-"));
    const previousTmpdir = process.env.TMPDIR;
    process.env.TMPDIR = stagingRoot;
    try {
      const error = await importPersonaBundle({ userId: 13, filePath: bundlePath }).catch(
        (thrown: unknown) => thrown,
      );
      expect(error).toBeInstanceOf(BackupFormatError);
      expect((error as Error).message).toContain("0-evil.html");
      await expect(fs.readdir(stagingRoot)).resolves.toEqual([]);
    } finally {
      if (previousTmpdir === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = previousTmpdir;
      rmSync(stagingRoot, { recursive: true, force: true });
    }
  });

  it("refuses a bundle whose message attachment is an html page", async () => {
    const root = tempRoot();
    const bundlePath = path.join(root, "evil-message.mirrai-persona");
    await writeBundle(bundlePath, {
      name: "0-evil.html",
      fileName: "0-evil.html",
      part: "messages",
    });
    await expect(importPersonaBundle({ userId: 13, filePath: bundlePath })).rejects.toBeInstanceOf(
      BackupFormatError,
    );
  });
});

describe("removeEmptyParents", () => {
  it("keeps walking after a directory that is already gone", async () => {
    /**
     * C9.5: two files in different subfolders are cleaned in either
     * order, so the second call often finds its leaf already gone. The
     * walk used to stop on that first `rmdir` failure and skip the empty
     * `personas/<user>/<persona>/` chain above it.
     */
    const root = tempRoot();
    const personaDir = path.join(root, "personas", "1", "5");
    await fs.mkdir(personaDir, { recursive: true });
    await removeEmptyParents(path.join(personaDir, "missing", "file.jpg"), root);
    await expect(fs.stat(personaDir)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(path.join(root, "personas"))).rejects.toMatchObject({ code: "ENOENT" });
    // The uploads root itself always stays.
    await expect(fs.stat(root)).resolves.toBeTruthy();
  });

  it("removes an ordinary empty chain but never the uploads root", async () => {
    const root = tempRoot();
    const personaDir = path.join(root, "personas", "2", "7");
    await fs.mkdir(personaDir, { recursive: true });
    const file = path.join(personaDir, "note.jpg");
    await fs.writeFile(file, "x");
    await fs.rm(file);
    await removeEmptyParents(file, root);
    await expect(fs.stat(path.join(root, "personas"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(root)).resolves.toBeTruthy();
  });

  it("keeps a directory that still holds something", async () => {
    const root = tempRoot();
    const personaDir = path.join(root, "personas", "3", "9");
    await fs.mkdir(personaDir, { recursive: true });
    await fs.writeFile(path.join(personaDir, "keep.txt"), "keep");
    await removeEmptyParents(path.join(personaDir, "other", "file.jpg"), root);
    await expect(fs.readFile(path.join(personaDir, "keep.txt"), "utf-8")).resolves.toBe("keep");
    await expect(fs.stat(personaDir)).resolves.toBeTruthy();
  });
});
