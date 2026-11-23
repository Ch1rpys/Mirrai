import { describe, expect, it } from "vitest";
import { GROUP_MIN_SAMPLES, measureGroup, normalizeGroupStats, type GroupRow } from "./group-stats";

/** A persona line, three code points long unless said otherwise. */
function them(content = "在的呀", kind: string | null = "text"): GroupRow {
  return { role: "assistant", content, kind };
}

/** A line from the user ("me"). */
function me(content = "在吗"): GroupRow {
  return { role: "user", content, kind: "text" };
}

/** A line from somebody else in the group. */
function other(content = "我也在"): GroupRow {
  return { role: "other", content, kind: "text" };
}

/** A message from neither me, the persona, nor a named other. */
function filler(content = "陪"): GroupRow {
  return { role: "system", content, kind: "text" };
}

/**
 * Persona lines separated by `gapFor(index)` filler lines.
 *
 * The gap before line `index` is the number of messages between it and
 * the persona's previous line, so the builder lets a test design the
 * gap sequence directly.
 */
function spaced(
  count: number,
  gapFor: (index: number) => number,
  contentFor: (index: number) => string,
): GroupRow[] {
  const rows: GroupRow[] = [];
  for (let index = 0; index < count; index += 1) {
    if (index > 0) {
      for (let n = 0; n < gapFor(index); n += 1) rows.push(filler());
    }
    rows.push(them(contentFor(index)));
  }
  return rows;
}

describe("measureGroup", () => {
  it("returns null until the persona has said forty lines", () => {
    const thirtyNine = Array.from({ length: 39 }, () => them());
    expect(GROUP_MIN_SAMPLES).toBe(40);
    expect(measureGroup(thirtyNine)).toBeNull();
    expect(measureGroup([...thirtyNine, me(), other(), them()])?.samples).toBe(40);
    // Rows from the other roles are not the persona's lines.
    expect(measureGroup(Array.from({ length: 60 }, () => me()))).toBeNull();
    expect(measureGroup([])).toBeNull();
  });

  it("counts an even number of lengths and an odd number of gaps", () => {
    // Forty lines: twenty of four code points and twenty of six, so the
    // median length sits between two values. The thirty-nine gaps are all
    // two, so that median is a plain middle value.
    const rows = spaced(
      40,
      () => 2,
      (index) => (index % 2 === 0 ? "😀😀😀😀" : "一二三四五六"),
    );
    const stats = measureGroup(rows);
    expect(stats).not.toBeNull();
    // Code points, not UTF-16 units: the emoji are one character each.
    expect(stats?.lengthMedian).toBe(5);
    expect(stats?.samples).toBe(40);
    expect(stats?.gapMedianMessages).toBe(2);
    expect(stats?.afterMeRate).toBe(0);
    expect(stats?.afterOthersRate).toBe(0);
  });

  it("counts an odd number of lengths and an even number of gaps", () => {
    // Forty-one lines: twenty of four, one of five, twenty of seven; the
    // middle value is five. Forty gaps alternate one and five, so the
    // median sits between two values.
    const rows = spaced(
      41,
      (index) => (index % 2 === 1 ? 1 : 5),
      (index) => (index < 20 ? "😀😀😀😀" : index === 20 ? "一二三四五" : "一二三四五六七"),
    );
    const stats = measureGroup(rows);
    expect(stats?.samples).toBe(41);
    expect(stats?.lengthMedian).toBe(5);
    // (1 + 5) / 2 — an even number of gaps.
    expect(stats?.gapMedianMessages).toBe(3);
  });

  it("reports a zero gap when the persona's lines are next to each other", () => {
    const consecutive = Array.from({ length: 40 }, (_, index) => them(String(index % 10)));
    const stats = measureGroup(consecutive);
    expect(stats?.gapMedianMessages).toBe(0);
    expect(stats?.samples).toBe(40);
  });

  it("counts a reply three messages later but not four", () => {
    const baseline = spaced(40, () => 1, () => "在的呀");
    const rows: GroupRow[] = [
      ...baseline,
      me("我来啦"), filler(), filler(), them(),
      me("有人吗"), filler(), filler(), filler(), them(),
      other("我也在"), filler(), them(),
      other("你们吃了吗"), filler(), filler(), filler(), filler(),
      me("最后一句"),
    ];
    const stats = measureGroup(rows);
    expect(stats).not.toBeNull();
    // Three of the persona's lines are added to the baseline forty.
    expect(stats?.samples).toBe(43);
    // One of two user lines is answered within three; the last one has no
    // later message at all and is not in the denominator.
    expect(stats?.afterMeRate).toBe(0.5);
    // The same for the other lines, and the two rates are kept apart.
    expect(stats?.afterOthersRate).toBe(0.5);
  });

  it("ignores stickers, empty lines and non-text rows of every role", () => {
    const rows: GroupRow[] = [
      // A missing kind means text.
      ...Array.from({ length: 40 }, () => them()),
      them("在的呀", "sticker"),
      them("", "text"),
      them("   ", "text"),
      // An image from me is not something the persona can answer.
      { role: "user", content: "看这个", kind: "image" },
      them(),
      // A real user line with no reply after it.
      me("我先吃饭"),
      filler(),
    ];
    const stats = measureGroup(rows);
    expect(stats).not.toBeNull();
    expect(stats?.samples).toBe(41);
    // If the image counted as a user line it would be a hit and the rate
    // would be 0.5. It does not.
    expect(stats?.afterMeRate).toBe(0);
  });
});

describe("normalizeGroupStats", () => {
  it("rejects anything that is not a measured object", () => {
    expect(normalizeGroupStats(null)).toBeNull();
    expect(normalizeGroupStats(undefined)).toBeNull();
    expect(normalizeGroupStats("group")).toBeNull();
    expect(normalizeGroupStats(42)).toBeNull();
    expect(normalizeGroupStats([])).toBeNull();
    expect(normalizeGroupStats({})).toBeNull();
    expect(normalizeGroupStats({ samples: 0 })).toBeNull();
    expect(normalizeGroupStats({ samples: -3 })).toBeNull();
    expect(normalizeGroupStats({ samples: "0" })).toBeNull();
  });

  it("coerces a stored value and clamps the rates", () => {
    expect(
      normalizeGroupStats({
        samples: "48",
        afterMeRate: "0.6",
        afterOthersRate: "0.2",
        lengthMedian: "7",
        gapMedianMessages: "4",
      }),
    ).toEqual({
      samples: 48,
      afterMeRate: 0.6,
      afterOthersRate: 0.2,
      lengthMedian: 7,
      gapMedianMessages: 4,
    });
    expect(
      normalizeGroupStats({
        samples: 45.9,
        afterMeRate: 1.5,
        afterOthersRate: -0.3,
        lengthMedian: -2,
        gapMedianMessages: Number.POSITIVE_INFINITY,
      }),
    ).toEqual({
      samples: 45,
      afterMeRate: 1,
      afterOthersRate: 0,
      lengthMedian: 0,
      gapMedianMessages: 0,
    });
  });

  it("fills missing numbers with zero but keeps a measured one", () => {
    expect(normalizeGroupStats({ samples: 40 })).toEqual({
      samples: 40,
      afterMeRate: 0,
      afterOthersRate: 0,
      lengthMedian: 0,
      gapMedianMessages: 0,
    });
    expect(
      normalizeGroupStats({ samples: 40, afterMeRate: Number.NaN, lengthMedian: "x" }),
    ).toEqual({
      samples: 40,
      afterMeRate: 0,
      afterOthersRate: 0,
      lengthMedian: 0,
      gapMedianMessages: 0,
    });
  });
});
