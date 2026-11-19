import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  isTextRecord,
  isUnparsedChatUpload,
  RECORD_KINDS,
  recordRegister,
  recordText,
  renderRecordContent,
} from "./records";

describe("the record kinds", () => {
  it("is the closed set from the sixth-stage design", () => {
    expect([...RECORD_KINDS]).toEqual([
      "text",
      "sticker",
      "image",
      "voice",
      "video",
      "location",
      "link",
      "music",
      "transfer",
      "redpacket",
      "pat",
      "recall",
      "call",
      "file",
      "system",
    ]);
  });
});

describe("isTextRecord", () => {
  it("treats a missing kind as text", () => {
    expect(isTextRecord({})).toBe(true);
    expect(isTextRecord({ kind: null })).toBe(true);
    expect(isTextRecord({ kind: "text" })).toBe(true);
  });

  it("rejects every other kind", () => {
    expect(isTextRecord({ kind: "sticker" })).toBe(false);
    expect(isTextRecord({ kind: "voice" })).toBe(false);
  });
});

describe("recordText", () => {
  it("returns the transcript of a voice row when there is one", () => {
    expect(
      recordText({
        kind: "voice",
        content: "[voice:12]",
        meta: { transcript: "刚下课", durationSec: 12 },
      }),
    ).toBe("刚下课");
  });

  it("returns the stored content when there is no transcript", () => {
    expect(recordText({ kind: "voice", content: "[voice:12]" })).toBe("[voice:12]");
    expect(recordText({ kind: "text", content: "在吗" })).toBe("在吗");
  });
});

describe("renderRecordContent", () => {
  it("leaves ordinary text and system lines alone", () => {
    expect(renderRecordContent({ kind: "text", content: "晚安" }, "en")).toBe("晚安");
    expect(renderRecordContent({ kind: "system", content: "你已添加对方" }, "zh")).toBe("你已添加对方");
  });

  it.each([
    [{ kind: "sticker", content: "[sticker:狗狗探头]" }, "zh", "［表情：狗狗探头］"],
    [{ kind: "sticker", content: "[sticker:狗狗探头]" }, "en", "[sticker: 狗狗探头]"],
    [{ kind: "sticker", content: "[sticker]" }, "zh", "［表情］"],
    [{ kind: "sticker", content: "[sticker]" }, "en", "[sticker]"],
    [{ kind: "image", content: "[image]" }, "zh", "［图片］"],
    [{ kind: "image", content: "[image]" }, "en", "[image]"],
    [{ kind: "voice", content: "[voice:12]" }, "zh", "［语音 12 秒］"],
    [{ kind: "voice", content: "[voice:12]" }, "en", "[voice 12s]"],
    [{ kind: "voice", content: "[voice]" }, "zh", "［语音］"],
    [{ kind: "voice", content: "[voice]" }, "en", "[voice]"],
    [{ kind: "video", content: "[video:8]" }, "zh", "［视频 8 秒］"],
    [{ kind: "video", content: "[video:8]" }, "en", "[video 8s]"],
    [{ kind: "video", content: "[video]" }, "zh", "［视频］"],
    [{ kind: "video", content: "[video]" }, "en", "[video]"],
    [{ kind: "location", content: "[location:星巴克]" }, "zh", "［位置：星巴克］"],
    [{ kind: "location", content: "[location:星巴克]" }, "en", "[location: 星巴克]"],
    [{ kind: "location", content: "[location]" }, "zh", "［位置］"],
    [{ kind: "location", content: "[location]" }, "en", "[location]"],
    [{ kind: "link", content: "[link:标题]" }, "zh", "［链接：标题］"],
    [{ kind: "link", content: "[link:标题]" }, "en", "[link: 标题]"],
    [{ kind: "link", content: "[link]" }, "zh", "［链接］"],
    [{ kind: "link", content: "[link]" }, "en", "[link]"],
    [{ kind: "music", content: "[music:歌]" }, "zh", "［音乐：歌］"],
    [{ kind: "music", content: "[music:歌]" }, "en", "[music: 歌]"],
    [{ kind: "music", content: "[music]" }, "zh", "［音乐］"],
    [{ kind: "music", content: "[music]" }, "en", "[music]"],
    [{ kind: "transfer", content: "[transfer:12.00]" }, "zh", "［转账：12.00］"],
    [{ kind: "transfer", content: "[transfer:12.00]" }, "en", "[transfer: 12.00]"],
    [{ kind: "transfer", content: "[transfer]" }, "zh", "［转账］"],
    [{ kind: "transfer", content: "[transfer]" }, "en", "[transfer]"],
    [{ kind: "redpacket", content: "[redpacket]" }, "zh", "［红包］"],
    [{ kind: "redpacket", content: "[redpacket]" }, "en", "[red packet]"],
    [{ kind: "pat", content: "[pat]" }, "zh", "［拍了拍］"],
    [{ kind: "pat", content: "[pat]" }, "en", "[pat]"],
    [{ kind: "recall", content: "[recall]" }, "zh", "［撤回］"],
    [{ kind: "recall", content: "[recall]" }, "en", "[recalled]"],
    [{ kind: "call", content: "[call:voice:2592]" }, "zh", "［语音通话 43 分 12 秒］"],
    [{ kind: "call", content: "[call:voice:2592]" }, "en", "[voice call 43 min 12s]"],
    [{ kind: "call", content: "[call:video:60]" }, "zh", "［视频通话 1 分］"],
    [{ kind: "call", content: "[call:video:60]" }, "en", "[video call 1 min]"],
    [{ kind: "file", content: "[file:note.txt]" }, "zh", "［文件：note.txt］"],
    [{ kind: "file", content: "[file:note.txt]" }, "en", "[file: note.txt]"],
    [{ kind: "file", content: "[file]" }, "zh", "［文件］"],
    [{ kind: "file", content: "[file]" }, "en", "[file]"],
  ] as const)("%j %s", (row, locale, expected) => {
    expect(renderRecordContent(row, locale)).toBe(expected);
  });
});

describe("recordRegister", () => {
  it("treats a missing register as private", () => {
    expect(recordRegister({})).toBe("private");
    expect(recordRegister({ meta: null })).toBe("private");
    expect(recordRegister({ meta: {} })).toBe("private");
  });

  it("reads an explicit register", () => {
    expect(recordRegister({ meta: { register: "group" } })).toBe("group");
    expect(recordRegister({ meta: { register: "written" } })).toBe("written");
  });
});

describe("isUnparsedChatUpload", () => {
  it("is true only for chat files that have never been parsed", () => {
    expect(isUnparsedChatUpload({ fileType: "chat_txt", parseStatus: null })).toBe(true);
    expect(isUnparsedChatUpload({ fileType: "chat_csv" })).toBe(true);
    expect(isUnparsedChatUpload({ fileType: "chat_export", parseStatus: null })).toBe(true);
    expect(isUnparsedChatUpload({ fileType: "archive" })).toBe(true);
    expect(isUnparsedChatUpload({ fileType: "chat_txt", parseStatus: "done" })).toBe(false);
    expect(isUnparsedChatUpload({ fileType: "image", parseStatus: null })).toBe(false);
  });
});

describe("reading a voice transcript", () => {
  /**
   * Tone and content read differently.
   *
   * A voice note's transcript is good evidence of what was said and bad
   * evidence of how the person types. The modules that measure tone
   * (fingerprint, n-gram rerank, exemplars, fixed replies) read text
   * rows only, so none of them may reach for `recordText`.
   */
  it("keeps recordText out of the modules that measure tone", () => {
    const root = path.resolve(__dirname, "..");
    const files = [
      "shared/style-fingerprint.ts",
      "server/chat/rerank-model.ts",
      "server/chat/exemplars.ts",
      "shared/ritual-table.ts",
    ];
    for (const file of files) {
      const source = readFileSync(path.join(root, file), "utf8");
      expect(source, `${file} must read text rows only`).not.toContain("recordText");
    }
  });
});
