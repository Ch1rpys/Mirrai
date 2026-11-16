import { describe, expect, it } from "vitest";
import {
  cleanText,
  decodeImportBytes,
  looksLikeJson,
  parseExportTime,
  parseTextPlaceholder,
  parseUnixTime,
} from "./normalize";

describe("decodeImportBytes", () => {
  it("strips a UTF-8 BOM", () => {
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("小满", "utf8")]);
    expect(decodeImportBytes(bytes)).toBe("小满");
  });

  it("reads UTF-16LE with a BOM", () => {
    const bytes = Buffer.from("\uFEFF小满", "utf16le");
    expect(decodeImportBytes(bytes)).toBe("小满");
  });

  it("falls back to GB18030 when the bytes are not UTF-8", () => {
    const bytes = Buffer.from([0xc4, 0xe3, 0xba, 0xc3]);
    expect(decodeImportBytes(bytes)).toBe("你好");
  });
});

describe("parseExportTime", () => {
  it("reads a zone-less wall clock in the user's zone", () => {
    expect(parseExportTime("2022-03-01 20:00:00", "Asia/Shanghai")?.toISOString()).toBe(
      "2022-03-01T12:00:00.000Z",
    );
  });

  it("reads a 12-hour clock and a slash-separated date", () => {
    expect(parseExportTime("3/1/22, 8:00 PM", "Asia/Shanghai", "mdy")?.toISOString()).toBe(
      "2022-03-01T12:00:00.000Z",
    );
  });

  it("reads a unix millisecond timestamp", () => {
    expect(parseUnixTime(1646136000000)?.toISOString()).toBe("2022-03-01T12:00:00.000Z");
  });
});

describe("cleanText", () => {
  it("drops zero-width characters and a leading BOM", () => {
    expect(cleanText("\uFEFF小\u200B满")).toBe("小满");
  });
});

describe("looksLikeJson", () => {
  it("does not treat a bracketed transcript timestamp as JSON", () => {
    expect(looksLikeJson("[2022-03-01 20:00:00] 小满：在吗")).toBe(false);
    expect(looksLikeJson('[{"from":"a"}]')).toBe(true);
    expect(looksLikeJson('{"messages":[]}')).toBe(true);
  });
});

describe("parseTextPlaceholder", () => {
  it.each([
    ["[图片]", "image", "[image]"],
    ["[Photo]", "image", "[image]"],
    ["<Media omitted>", "image", "[image]"],
    ["<图片>", "image", "[image]"],
    ["[表情]", "sticker", "[sticker]"],
    ["[动画表情]", "sticker", "[sticker]"],
    ["[Sticker]", "sticker", "[sticker]"],
    ["[表情:狗狗探头]", "sticker", "[sticker:狗狗探头]"],
    ["[语音]", "voice", "[voice]"],
    ["[语音 12秒]", "voice", "[voice:12]"],
    ["[Voice]", "voice", "[voice]"],
    ["[视频]", "video", "[video]"],
    ["[Video]", "video", "[video]"],
    ["[位置]", "location", "[location]"],
    ["[Location]", "location", "[location]"],
    ["[链接]", "link", "[link]"],
    ["[文件]", "file", "[file]"],
    ["[音乐]", "music", "[music]"],
    ["[转账]", "transfer", "[transfer]"],
    ["微信转账", "transfer", "[transfer]"],
    ["[红包]", "redpacket", "[redpacket]"],
    ["你撤回了一条消息", "recall", "[recall]"],
    ["Alice recalled a message", "recall", "[recall]"],
    ["拍了拍我", "pat", "[pat]"],
    ["[语音通话]", "call", "[call:voice:0]"],
    ["[视频通话]", "call", "[call:video:0]"],
  ])("%s → %s", (raw, kind, content) => {
    expect(parseTextPlaceholder(raw)).toMatchObject({ kind, content });
  });

  it("reads a voice-call clock as seconds", () => {
    expect(parseTextPlaceholder("[语音通话] 时长 00:43:12")).toEqual({
      kind: "call",
      content: "[call:voice:2592]",
      meta: { mode: "voice", durationSec: 2592 },
    });
  });

  it("does not treat the word 图片 inside a sentence as an image", () => {
    expect(parseTextPlaceholder("那张图片很好看")).toBeNull();
    expect(parseTextPlaceholder("发张图片给我")).toBeNull();
  });
});
