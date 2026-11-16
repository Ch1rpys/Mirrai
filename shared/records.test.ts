import { describe, expect, it } from "vitest";
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
  it("returns the stored token until C1.3 paints it", () => {
    expect(renderRecordContent({ kind: "sticker", content: "[sticker:狗狗探头]" }, "zh")).toBe(
      "[sticker:狗狗探头]",
    );
    expect(renderRecordContent({ kind: "text", content: "晚安" }, "en")).toBe("晚安");
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
    expect(isUnparsedChatUpload({ fileType: "chat_txt", parseStatus: "done" })).toBe(false);
    expect(isUnparsedChatUpload({ fileType: "image", parseStatus: null })).toBe(false);
  });
});
