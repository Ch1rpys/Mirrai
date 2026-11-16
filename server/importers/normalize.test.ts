import { describe, expect, it } from "vitest";
import {
  cleanText,
  decodeImportBytes,
  looksLikeJson,
  parseExportTime,
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
