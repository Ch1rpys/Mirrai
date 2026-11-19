import { describe, expect, it } from "vitest";
import { prepareForSpeech, PROSODY_BASIS, prosodyToTts } from "./prosody";

/**
 * The mapping from a measurement to a reading.
 *
 * The numbers are not a taste: 5.04 characters a second against a 4.2
 * basis is twenty percent faster, and that is what the engine is told.
 */
describe("prosody to read-aloud", () => {
  it("maps five characters a second to twenty percent faster", () => {
    const direction = prosodyToTts(
      { charsPerSec: 5.04, pauseRatio: 0.1, tailSec: 0.2, samples: 12 },
      "zh",
    );
    expect(direction.ratePercent).toBe(20);
  });

  it("clamps an extreme measurement", () => {
    expect(
      prosodyToTts({ charsPerSec: 40, samples: 12 }, "zh").ratePercent,
    ).toBe(30);
    expect(
      prosodyToTts({ charsPerSec: 0.1, samples: 12 }, "zh").ratePercent,
    ).toBe(-30);
  });

  it("uses the English basis for English", () => {
    const direction = prosodyToTts({ charsPerSec: 18, samples: 10 }, "en");
    expect(direction.ratePercent).toBe(20);
    expect(PROSODY_BASIS.en).toBe(15);
  });

  it("turns a space between two characters into a pause", () => {
    expect(prepareForSpeech("今天 好累")).toBe("今天，好累");
    expect(prepareForSpeech("今天 好累", { markSpaces: false })).toBe("今天 好累");
    expect(prepareForSpeech("hello world")).toBe("hello world");
  });

  it("lengthens an ellipsis only when the pauses are long", () => {
    expect(prepareForSpeech("等一下...", { lengthenEllipsis: true })).toBe("等一下……");
    expect(prepareForSpeech("等一下...", { lengthenEllipsis: false })).toBe("等一下...");
    expect(prepareForSpeech("等一下…", { lengthenEllipsis: true })).toBe("等一下……");
  });

  it("does not change a single character", () => {
    const line = "今天 好累... 我先 睡啦…";
    const before = Array.from(line).filter((char) => /\p{Script=Han}/u.test(char));
    const after = Array.from(prepareForSpeech(line, { lengthenEllipsis: true })).filter(
      (char) => /\p{Script=Han}/u.test(char),
    );
    expect(after).toEqual(before);
  });

  it("uses the direction's own preparation", () => {
    const direction = prosodyToTts(
      { charsPerSec: 4.2, pauseRatio: 0.3, samples: 10 },
      "zh",
    );
    expect(direction.ratePercent).toBe(0);
    expect(direction.prepare("在吗 我到家了...")).toBe("在吗，我到家了……");
  });

  it("survives a missing measurement", () => {
    const direction = prosodyToTts({ charsPerSec: 0, samples: 0 }, "zh");
    expect(direction.ratePercent).toBe(0);
  });
});
