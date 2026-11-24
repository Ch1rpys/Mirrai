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
import { bundleFileAllowed, importPersonaBundle } from "./bundle";

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
    const error = await importPersonaBundle({ userId: 13, filePath: bundlePath }).catch(
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(BackupFormatError);
    expect((error as Error).message).toContain("0-evil.html");
    // Nothing was written to a staging directory that outlives the call.
    await expect(fs.readdir(root)).resolves.toEqual(["evil.mirrai-persona"]);
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
