import { describe, expect, it } from "vitest";
import { decodeBase64Image, sniffPersonaImage } from "./persona-image";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const WEBP = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([0x1a, 0x00, 0x00, 0x00]),
  Buffer.from("WEBPVP8 "),
]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

describe("recognising an avatar image", () => {
  it("reads the three accepted kinds from the bytes", () => {
    expect(sniffPersonaImage(PNG)).toBe("png");
    expect(sniffPersonaImage(JPEG)).toBe("jpeg");
    expect(sniffPersonaImage(WEBP)).toBe("webp");
  });

  it("refuses anything else, whatever it is called", () => {
    expect(sniffPersonaImage(SVG)).toBeNull();
    expect(sniffPersonaImage(Buffer.from("GIF89a"))).toBeNull();
  });

  it("decodes a data URL and a bare base64 string", () => {
    const dataUrl = `data:image/png;base64,${PNG.toString("base64")}`;
    expect(decodeBase64Image(dataUrl, 1024)?.equals(PNG)).toBe(true);
    expect(decodeBase64Image(PNG.toString("base64"), 1024)?.equals(PNG)).toBe(true);
  });

  it("refuses an empty value and one over the limit", () => {
    expect(decodeBase64Image("", 1024)).toBeNull();
    expect(decodeBase64Image(PNG.toString("base64"), 4)).toBeNull();
  });
});
