import { describe, expect, it } from "vitest";
import path from "node:path";
import { exifDateToWallClock, readImageExif } from "./image-exif";

const FIXTURES = path.resolve(__dirname, "..", "test-fixtures", "media");

describe("reading a photograph's own tags", () => {
  it("reads the camera's time in the user's zone and the place", async () => {
    const exif = await readImageExif(path.join(FIXTURES, "exif-sample.jpg"), "Asia/Shanghai");
    // 2022-04-02 12:00 on the camera's clock, read as Shanghai time.
    expect(exif.at?.toISOString()).toBe("2022-04-02T04:00:00.000Z");
    expect(exif.lat).toBeCloseTo(31.2303, 3);
    expect(exif.lng).toBeCloseTo(121.4739, 3);
    expect(exif.width).toBe(4);
    expect(exif.height).toBe(4);
  });

  it("reads a picture without EXIF as one with no time and no place", async () => {
    const exif = await readImageExif(path.join(FIXTURES, "no-exif.jpg"), "Asia/Shanghai");
    expect(exif).toEqual({ at: null, lat: null, lng: null, width: null, height: null });
  });

  it("does not throw on a file that is not an image", async () => {
    const exif = await readImageExif(Buffer.from("not an image"), "Asia/Shanghai");
    expect(exif.at).toBeNull();
  });

  it("turns the EXIF stamp into the parser's wall clock", () => {
    expect(exifDateToWallClock("2022:04:02 12:00:00")).toBe("2022-04-02 12:00:00");
    expect(exifDateToWallClock("2022:04:02 12:00:00.123")).toBe("2022-04-02 12:00:00");
    expect(exifDateToWallClock("April 2")).toBeNull();
  });
});
