import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The page the browser is shown when the app is not there.
 *
 * It was English only — and the app is not. The service worker cannot
 * read the app's own language setting, but it does know the browser's
 * language, and that is what the person is reading.
 */

const ROOT = path.resolve(__dirname, "..");

describe("the offline page", () => {
  it("speaks the reader's language", () => {
    const source = readFileSync(path.join(ROOT, "client/public/sw.js"), "utf-8");

    // Both languages are there.
    expect(source).toContain("离线");
    expect(source).toContain("Offline");
    // And the choice is made from the browser's own language.
    expect(source).toContain("navigator");
  });

  it("has a generic notification in both languages", () => {
    const source = readFileSync(path.join(ROOT, "client/public/sw.js"), "utf-8");
    expect(source).toContain("有一条新消息");
    expect(source).toContain("There is a new message");
    expect(source).toContain("function notificationCopy");
    expect(source).toContain("navigator");
  });

  it("says the app's name, not the page's", () => {
    const source = readFileSync(path.join(ROOT, "client/public/sw.js"), "utf-8");
    // The English page said "This page needs the app to be running" —
    // and the app has a name.
    expect(source).toContain("Mirrai");
  });
});

describe("the manifest", () => {
  it("speaks both languages", () => {
    const manifest = JSON.parse(
      readFileSync(path.join(ROOT, "client/public/manifest.webmanifest"), "utf-8"),
    );
    // The description and the shortcut names were Chinese only — so an
    // English user's home screen said so.
    expect(manifest.description).toContain("/");
    for (const shortcut of manifest.shortcuts) {
      expect(shortcut.name).toContain("/");
      expect(shortcut.description).toContain("/");
    }
  });

  it("has a shortcut for the mailbox and for the last conversation", () => {
    const manifest = JSON.parse(
      readFileSync(path.join(ROOT, "client/public/manifest.webmanifest"), "utf-8"),
    );
    const byUrl = new Map(manifest.shortcuts.map((shortcut: any) => [shortcut.url, shortcut]));
    const mailbox = byUrl.get("/letters") as any;
    const last = byUrl.get("/chat/last") as any;
    expect(mailbox, "a shortcut for /letters").toBeTruthy();
    expect(last, "a shortcut for /chat/last").toBeTruthy();
    // Both names carry both languages, like every other shortcut.
    expect(mailbox.name).toContain("信箱");
    expect(mailbox.name).toContain("Mailbox");
    expect(last.name).toContain("最近聊的");
    expect(last.name).toContain("Last chat");
    expect(mailbox.description).toContain("/");
    expect(last.description).toContain("/");
  });

  it("declares a share target that takes files", () => {
    // The manifest shape is the one the Web Share Target API requires:
    // POST + multipart/form-data + a named `files` parameter.
    // https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/share_target
    const manifest = JSON.parse(
      readFileSync(path.join(ROOT, "client/public/manifest.webmanifest"), "utf-8"),
    );
    expect(manifest.share_target).toMatchObject({
      action: "/share-target",
      method: "POST",
      enctype: "multipart/form-data",
    });
    const files = manifest.share_target.params.files;
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("files");
    expect(files[0].accept).toEqual(
      expect.arrayContaining(["text/*", "application/zip", "application/json", ".csv", ".html"]),
    );
  });
});
