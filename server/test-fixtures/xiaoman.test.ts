import { describe, expect, it } from "vitest";
import { measureGroup } from "@shared/group-stats";
import { parseTranscriptMessages } from "../skill-engine/micro-rules";
import { renderFixture } from "./render";
import {
  buildGroupFixture,
  buildXiaomanRecords,
  charCount,
  deriveXiaomanTruth,
  formatShanghai,
  GROUP_FIXTURE_TRUTH,
  wallClock,
  XIAOMAN_DEFAULT_SEED,
  XIAOMAN_NAME,
  XIAOMAN_TRUTH,
  XIAOMAN_USER_NAME,
  type FixtureRecord,
  type FixtureSlot,
  type FixtureState,
} from "./xiaoman";

const records = buildXiaomanRecords();
const derived = deriveXiaomanTruth(records);

function taText(rows: FixtureRecord[] = records): FixtureRecord[] {
  return rows.filter((row) => row.role === "assistant" && row.kind === "text");
}

function rate(n: number, d: number): number {
  return d === 0 ? 0 : n / d;
}

function expectRate(n: number, d: number, target: number, tol = 0.05): void {
  const value = rate(n, d);
  expect(value).toBeGreaterThanOrEqual(target - tol);
  expect(value).toBeLessThanOrEqual(target + tol);
}

function ymd(row: FixtureRecord): number {
  const w = wallClock(row.timestamp);
  return w.year * 10_000 + w.month * 100 + w.day;
}

function scenesBySlot(slot: FixtureSlot): typeof derived.scenes {
  return derived.scenes.filter((scene) => scene.slot === slot);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return 0;
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function logSigma(values: number[]): number {
  const logs = values.filter((value) => value > 0).map((value) => Math.log(value));
  if (logs.length < 2) return 0;
  const mean = logs.reduce((sum, value) => sum + value, 0) / logs.length;
  const variance = logs.reduce((sum, value) => sum + (value - mean) ** 2, 0) / logs.length;
  return Math.sqrt(variance);
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx]!;
}

function isoWeekKey(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day));
  const thursday = new Date(date);
  thursday.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

describe("P0.5 Xiaoman fixture", () => {
  it("is deterministic for one seed and different for another", () => {
    const a = buildXiaomanRecords({ seed: "alpha" });
    const b = buildXiaomanRecords({ seed: "alpha" });
    const c = buildXiaomanRecords({ seed: "beta" });
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it("builds within the handbook's two-second budget", () => {
    const started = performance.now();
    buildXiaomanRecords({ seed: "speed" });
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it("round-trips text rows through generic-line", () => {
    const text = renderFixture(records, "generic-line");
    const parsed = parseTranscriptMessages(text, { personaName: XIAOMAN_NAME });
    const textRows = records.filter((row) => row.kind === "text");
    expect(parsed.length).toBe(textRows.length);
    expect(parsed.filter((row) => row.role === "persona").length).toBe(
      textRows.filter((row) => row.speaker === XIAOMAN_NAME).length,
    );
  });
});

describe("时间跨度", () => {
  it("spans 2022-03-01 to 2024-10-31 with a 25-day silence", () => {
    const stamps = records.map(ymd);
    expect(Math.min(...stamps)).toBeGreaterThanOrEqual(2022_03_01);
    expect(Math.max(...stamps)).toBeLessThanOrEqual(2024_10_31);
    const silent = records.filter((row) => ymd(row) >= 2023_06_10 && ymd(row) <= 2023_07_04);
    expect(silent).toHaveLength(0);
    expect(XIAOMAN_TRUTH.silence.days).toBe(25);
    for (const row of records) {
      expect(row.truth.period).toBe(ymd(row) < 2023_06_10 ? "p1" : "p2");
    }
  });
});

describe("规模", () => {
  it("has about 160 active days and about 3200 TA lines", () => {
    const mainDays = new Set(
      records
        .filter((row) => row.truth.slot === "evening" || row.truth.slot === "noon" || row.truth.slot === "afternoon")
        .map((row) => ymd(row)),
    );
    expect(mainDays.size).toBe(XIAOMAN_TRUTH.activeDays);
    const taRows = records.filter((row) => row.role === "assistant").length;
    expect(taRows).toBeGreaterThanOrEqual(XIAOMAN_TRUTH.taLinesMin);
    /*
     * The handbook's "default size about 3200" is the TA side of the
     * log: 160 active days times ten rounds times an average burst of
     * about two lines. The total row count is larger by construction
     * because the user writes once per round.
     */
    expect(XIAOMAN_TRUTH.taLinesApprox).toBe(3200);
    expect(taRows).toBeGreaterThanOrEqual(Math.round(3200 * 0.95));
    expect(taRows).toBeLessThanOrEqual(Math.round(3200 * 1.05));
    expect(records.length).toBeGreaterThan(2000);
    expect(records.length).toBeLessThan(8000);
    const ordinary = derived.scenes.filter(
      (scene) =>
        (scene.slot === "evening" || scene.slot === "noon" || scene.slot === "afternoon") &&
        scene.conflictEpisode == null,
    );
    for (const scene of ordinary) {
      const userTurns = records.filter((row) => row.truth.sceneId === scene.id && row.role === "user").length;
      expect(userTurns).toBe(scene.slot === "evening" ? XIAOMAN_TRUTH.roundsPerMainScene + 1 : XIAOMAN_TRUTH.roundsPerMainScene);
    }
  });
});

describe("场景时段", () => {
  it("starts 70% of main scenes in the evening and 20% at noon", () => {
    const main = derived.scenes.filter(
      (scene) => scene.slot === "evening" || scene.slot === "noon" || scene.slot === "afternoon",
    );
    expectRate(main.filter((scene) => scene.slot === "evening").length, main.length, 0.7);
    expectRate(main.filter((scene) => scene.slot === "noon").length, main.length, 0.2);
    for (const scene of scenesBySlot("evening")) {
      const start = wallClock(scene.start);
      const end = wallClock(scene.end);
      const startMin = start.hour * 60 + start.minute;
      expect(startMin).toBeGreaterThanOrEqual(20 * 60);
      expect(startMin).toBeLessThanOrEqual(23 * 60 + 20);
      expect(end.hour).toBeLessThan(24);
      if (end.year === start.year && end.month === start.month && end.day === start.day) {
        expect(end.hour * 60 + end.minute).toBeLessThan(24 * 60);
      }
    }
    for (const scene of scenesBySlot("noon")) {
      const start = wallClock(scene.start);
      expect(start.hour).toBeGreaterThanOrEqual(12);
      expect(start.hour).toBeLessThan(13) ; // 12:00–12:59; 13:00 is the closed end
    }
    const wed = scenesBySlot("wednesday");
    expect(wed.length).toBeGreaterThanOrEqual(20);
    for (const scene of wed) {
      const start = wallClock(scene.start);
      expect(start.hour * 60 + start.minute).toBeGreaterThanOrEqual(16 * 60 + 5);
    }
  });
});

describe("早晚的往来", () => {
  it("closes evening scenes with 晚安 and keeps 早 as its own one-exchange scene", () => {
    const eveningGoodnight = records.filter((row) => row.truth.ritual === "晚安" && row.role === "assistant");
    expect(eveningGoodnight.length).toBeGreaterThanOrEqual(XIAOMAN_TRUTH.goodnight.min);
    for (const scene of scenesBySlot("evening")) {
      const rows = records
        .filter((row) => row.truth.sceneId === scene.id)
        .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      const tail = rows.slice(-2);
      expect(tail[0]?.role).toBe("user");
      expect(tail[0]?.content).toBe("晚安");
      expect(tail[1]?.role).toBe("assistant");
      expect(tail[1]?.truth.ritual).toBe("晚安");
      const end = wallClock(scene.end);
      const start = wallClock(scene.start);
      expect(end.year).toBe(start.year);
      expect(end.month).toBe(start.month);
      expect(end.day).toBe(start.day);
    }
    const mornings = scenesBySlot("morning");
    expect(mornings.length).toBeGreaterThanOrEqual(XIAOMAN_TRUTH.morning.min);
    for (const scene of mornings) {
      const rows = records.filter((row) => row.truth.sceneId === scene.id);
      expect(rows).toHaveLength(2);
      const start = wallClock(scene.start);
      const startMin = start.hour * 60 + start.minute;
      expect(startMin).toBeGreaterThanOrEqual(7 * 60 + 30);
      expect(startMin).toBeLessThanOrEqual(8 * 60 + 30);
    }
  });
});

describe("时间戳", () => {
  /**
   * Whole seconds everywhere except inside a burst.
   *
   * The design's "every timestamp is precise to the second" cannot hold
   * for the second and third line of a burst: the designed gap is the
   * message's length times 200ms. Deviation 180 confines the sub-second
   * stamps to that case plus the two things timed off a burst close (a
   * sticker, and a follow-up that lands 6–12 minutes after it), and
   * renders every stamp to the second.
   */
  it("keeps every timestamp outside a burst on a whole second and renders to the second", () => {
    const insideBurst = (row: FixtureRecord) => (row.truth.burstIndex ?? 0) >= 1;
    const timedOffBurstClose = (row: FixtureRecord) =>
      row.kind === "sticker" || row.truth.ritual === "follow-up";
    const precise = records.filter((row) => !insideBurst(row) && !timedOffBurstClose(row));
    expect(precise.length).toBeGreaterThan(3000);
    expect(precise.filter((row) => row.timestamp.getMilliseconds() !== 0)).toEqual([]);
    expect(records.some((row) => row.timestamp.getMilliseconds() !== 0)).toBe(true);
    for (const row of records) {
      expect(formatShanghai(row.timestamp)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    }
    for (const row of insideBurstPreciseSample()) {
      const w = wallClock(row.timestamp);
      expect(w.second).toBeGreaterThanOrEqual(0);
      expect(w.second).toBeLessThan(60);
    }
  });

  function insideBurstPreciseSample(): FixtureRecord[] {
    return records.filter((row) => (row.truth.burstIndex ?? 0) >= 1).slice(0, 20);
  }
});

describe("场景情绪", () => {
  it("assigns one state per main scene at the designed mix", () => {
    const main = derived.scenes.filter(
      (scene) => scene.slot === "evening" || scene.slot === "noon" || scene.slot === "afternoon",
    );
    const counts: Record<FixtureState, number> = {
      warm: 0,
      happy: 0,
      playful: 0,
      distant: 0,
      nostalgic: 0,
      melancholy: 0,
    };
    for (const scene of main) counts[scene.state]++;
    for (const [state, target] of Object.entries(XIAOMAN_TRUTH.states) as Array<[FixtureState, number]>) {
      expectRate(counts[state], main.length, target);
    }
  });
});

describe("字数", () => {
  it("keeps TA text short: p1 median 10, p2 median 6, p95 ≤ 24", () => {
    const p1 = taText().filter((row) => row.truth.period === "p1").map((row) => charCount(row.content));
    const p2 = taText().filter((row) => row.truth.period === "p2").map((row) => charCount(row.content));
    expect(median(p1)).toBe(XIAOMAN_TRUTH.taMedianP1);
    expect(median(p2)).toBe(XIAOMAN_TRUTH.taMedianP2);
    expect(percentile([...p1, ...p2], 95)).toBeLessThanOrEqual(XIAOMAN_TRUTH.taP95Max);
  });
});

describe("句末", () => {
  it("never ends a non-distant line with a period, and distant lines are short periods", () => {
    const nonDistant = taText().filter((row) => row.truth.state !== "distant");
    expect(nonDistant.filter((row) => row.content.endsWith("。")).length).toBe(0);
    const distant = taText().filter((row) => row.truth.state === "distant");
    expectRate(distant.filter((row) => row.content.endsWith("。")).length, distant.length, 0.9);
    expect(distant.filter((row) => row.content.endsWith("。") && charCount(row.content) > 4).length).toBe(0);
  });
});

describe("语气词", () => {
  it("uses 呀 / 啦 / 嘛 at the designed rates and never 呢", () => {
    const nonDistant = taText().filter((row) => row.truth.state !== "distant");
    expectRate(nonDistant.filter((row) => row.content.endsWith("呀")).length, nonDistant.length, 0.3);
    expectRate(nonDistant.filter((row) => row.content.endsWith("啦")).length, nonDistant.length, 0.2);
    expectRate(nonDistant.filter((row) => row.content.endsWith("嘛")).length, nonDistant.length, 0.1);
    expect(taText().filter((row) => row.content.includes("呢")).length).toBe(0);
  });
});

describe("笑", () => {
  it("puts 哈哈哈哈 in 12% of happy/playful lines and never 呵呵", () => {
    const pool = taText().filter((row) => row.truth.state === "happy" || row.truth.state === "playful");
    expectRate(pool.filter((row) => row.content.includes("哈哈哈哈")).length, pool.length, 0.12);
    expect(records.filter((row) => row.content.includes("呵呵")).length).toBe(0);
  });
});

describe("其他标点", () => {
  it("writes an ellipsis only as ... and never uses ～ or emoji", () => {
    expect(records.filter((row) => row.content.includes("…")).length).toBe(0);
    expect(records.filter((row) => row.content.includes("。。。")).length).toBe(0);
    expect(records.filter((row) => row.content.includes("～")).length).toBe(0);
    expect(records.filter((row) => /\p{Extended_Pictographic}/u.test(row.content)).length).toBe(0);
    // The allowed form exists, so the rule above is not testing an empty set.
    const ellipsisRows = records.filter((row) => row.content.includes("..."));
    expect(ellipsisRows.length).toBeGreaterThan(0);
    for (const row of ellipsisRows) {
      for (const run of row.content.matchAll(/\.+/g)) {
        expect(run[0]).toBe("...");
      }
    }
  });
});

describe("称呼", () => {
  it("says 树树 on a fifth of TA lines and 陈树 when distant", () => {
    expectRate(taText().filter((row) => row.content.includes("树树")).length, taText().length, 0.2);
    const distant = taText().filter((row) => row.truth.state === "distant");
    const nonDistant = taText().filter((row) => row.truth.state !== "distant");
    expect(distant.filter((row) => row.content.includes("树树")).length).toBe(0);
    expect(nonDistant.filter((row) => row.content.includes("陈树")).length).toBe(0);
    expect(distant.filter((row) => row.content.includes("陈树")).length).toBeGreaterThan(0);
  });
});

describe("连发", () => {
  it("bursts 1/2/3 at 40/40/20 and spaces them by 200ms per character", () => {
    const bursts = new Map<number, FixtureRecord[]>();
    for (const row of records) {
      if (row.truth.burstId == null) continue;
      const list = bursts.get(row.truth.burstId) ?? [];
      list.push(row);
      bursts.set(row.truth.burstId, list);
    }
    const sizes = [...bursts.values()].map((group) => group.filter((row) => row.kind === "text").length);
    expectRate(sizes.filter((n) => n === 1).length, sizes.length, 0.4);
    expectRate(sizes.filter((n) => n === 2).length, sizes.length, 0.4);
    expectRate(sizes.filter((n) => n === 3).length, sizes.length, 0.2);
    for (const group of bursts.values()) {
      const texts = group.filter((row) => row.kind === "text").sort((a, b) => (a.truth.burstIndex ?? 0) - (b.truth.burstIndex ?? 0));
      for (let i = 1; i < texts.length; i++) {
        const expected = charCount(texts[i]!.content) * XIAOMAN_TRUTH.burstGapMsPerChar;
        const actual = texts[i]!.timestamp.getTime() - texts[i - 1]!.timestamp.getTime();
        expect(actual).toBeGreaterThanOrEqual(expected * 0.8);
        expect(actual).toBeLessThanOrEqual(expected * 1.2);
      }
    }
  });
});

describe("回复间隔", () => {
  it("replies with a 40s evening median and a 120s noon/wednesday median", () => {
    const evening: number[] = [];
    const daytime: number[] = [];
    const byScene = new Map<number, FixtureRecord[]>();
    for (const row of records) {
      const list = byScene.get(row.truth.sceneId) ?? [];
      list.push(row);
      byScene.set(row.truth.sceneId, list);
    }
    for (const rows of byScene.values()) {
      const ordered = [...rows].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      for (let i = 0; i < ordered.length; i++) {
        const user = ordered[i]!;
        if (user.role !== "user") continue;
        const reply = ordered.slice(i + 1).find((row) => row.role === "assistant");
        if (!reply) continue;
        const delay = (reply.timestamp.getTime() - user.timestamp.getTime()) / 1000;
        if (user.truth.slot === "evening") evening.push(delay);
        if (user.truth.slot === "noon" || user.truth.slot === "wednesday") daytime.push(delay);
      }
    }
    expect(median(evening)).toBeGreaterThan(25);
    expect(median(evening)).toBeLessThan(60);
    expect(median(daytime)).toBeGreaterThan(80);
    expect(median(daytime)).toBeLessThan(180);
    expect(Math.abs(logSigma(evening) - XIAOMAN_TRUTH.replySigma)).toBeLessThan(0.08);
    expect(Math.abs(logSigma(daytime) - XIAOMAN_TRUTH.replySigma)).toBeLessThan(0.08);
  });
});

describe("作息", () => {
  it("has no TA messages in 00:00–07:30, none on Wednesday 14:00–16:00, and 刚下课 after class", () => {
    const sleeping = records.filter((row) => {
      if (row.role !== "assistant") return false;
      const w = wallClock(row.timestamp);
      return w.hour < 7 || (w.hour === 7 && w.minute < 30);
    });
    expect(sleeping.length).toBe(0);
    const quiet = records.filter((row) => {
      const w = wallClock(row.timestamp);
      return w.weekday === 3 && w.hour >= 14 && w.hour < 16;
    });
    expect(quiet.length).toBe(0);
    const firstLines = scenesBySlot("wednesday").map((scene) => {
      const rows = records
        .filter((row) => row.truth.sceneId === scene.id && row.role === "assistant")
        .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      return rows[0];
    });
    expect(firstLines.every((row) => row?.content === "刚下课")).toBe(true);
    const weeks = new Set(
      scenesBySlot("wednesday").map((scene) => {
        const w = wallClock(scene.start);
        return isoWeekKey(w.year, w.month, w.day);
      }),
    );
    expect(weeks.size).toBeGreaterThanOrEqual(XIAOMAN_TRUTH.wednesdayWeeksMin);
  });
});

describe("固定回法", () => {
  it("answers 晚安 / 早 / 在吗 at the designed mix", () => {
    const goodnight = taText().filter((row) => row.truth.ritual === "晚安");
    expect(goodnight.length).toBeGreaterThanOrEqual(100);
    expectRate(goodnight.filter((row) => row.content === "晚安").length, goodnight.length, 0.6);
    expectRate(goodnight.filter((row) => row.content === "安").length, goodnight.length, 0.25);
    expectRate(goodnight.filter((row) => row.content === "睡啦").length, goodnight.length, 0.15);
    const morning = taText().filter((row) => row.truth.ritual === "早");
    expect(morning.length).toBeGreaterThanOrEqual(40);
    expectRate(morning.filter((row) => row.content === "早呀").length, morning.length, 0.7);
    expectRate(morning.filter((row) => row.content === "早").length, morning.length, 0.3);
    const zaime = taText().filter((row) => row.truth.ritual === "在吗");
    expect(zaime.length).toBeGreaterThanOrEqual(30);
    expectRate(zaime.filter((row) => row.content === "在").length, zaime.length, 0.8);
    expectRate(zaime.filter((row) => row.content === "咋啦").length, zaime.length, 0.2);
  });
});

describe("时期差异", () => {
  it("asks more in p1 and shifts acts from affection to acknowledge", () => {
    const p1 = taText().filter((row) => row.truth.period === "p1");
    const p2 = taText().filter((row) => row.truth.period === "p2");
    expectRate(p1.filter((row) => /[?？]$/.test(row.content)).length, p1.length, 0.2);
    expectRate(p2.filter((row) => /[?？]$/.test(row.content)).length, p2.length, 0.03);
    expectRate(p1.filter((row) => row.truth.act === "affection").length, p1.length, 0.25);
    expectRate(p2.filter((row) => row.truth.act === "acknowledge").length, p2.length, 0.3);
  });
});

describe("冲突", () => {
  it("has six noon-started conflicts that reconcile between 15:00 and 21:00", () => {
    const episodes = new Set(
      records.filter((row) => row.truth.conflictEpisode != null).map((row) => row.truth.conflictEpisode),
    );
    expect(episodes.size).toBe(6);
    expect(records.filter((row) => row.content === "就嗯？")).toHaveLength(6);
    expect(records.filter((row) => row.role === "user" && row.content === "嗯" && row.truth.conflictEpisode != null).length).toBe(6);
    expect(records.filter((row) => row.content === "好啦 不气了")).toHaveLength(4);
    expect(records.filter((row) => row.content === "对不起嘛")).toHaveLength(2);
    expect(records.filter((row) => row.content === "哼" && row.truth.ritual === "conflict-repair")).toHaveLength(2);
    const repairs = records.filter((row) => row.truth.ritual === "conflict-repair");
    for (const row of repairs) {
      const w = wallClock(row.timestamp);
      expect(w.hour).toBeGreaterThanOrEqual(15);
      expect(w.hour).toBeLessThan(21);
    }
    const measuredHours: number[] = [];
    for (const episode of episodes) {
      const rows = records
        .filter((row) => row.truth.conflictEpisode === episode)
        .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      const trigger = rows.find((row) => row.content === "就嗯？");
      const repair = rows.find((row) => row.truth.ritual === "conflict-repair");
      expect(trigger).toBeTruthy();
      expect(repair).toBeTruthy();
      // The handbook says every fight starts in a noon scene and starts
      // because I answered a two-line burst with a single「嗯」.
      expect(trigger!.truth.slot).toBe("noon");
      const hmm = rows.find(
        (row) => row.role === "user" && row.content === "嗯" && row.truth.conflictEpisode === episode,
      );
      expect(hmm).toBeTruthy();
      const sameScene = records
        .filter((row) => row.truth.sceneId === hmm!.truth.sceneId)
        .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      const at = sameScene.findIndex((row) => row.id === hmm!.id);
      const before = sameScene.slice(at - 2, at);
      expect(before.map((row) => row.role)).toEqual(["assistant", "assistant"]);
      expect(before[0]!.truth.burstId).toBe(before[1]!.truth.burstId);
      expect(before.map((row) => row.truth.burstIndex)).toEqual([0, 1]);
      const gapMs = repair!.timestamp.getTime() - trigger!.timestamp.getTime();
      measuredHours.push(gapMs / 3_600_000);
      const between = records.filter(
        (row) => row.timestamp > trigger!.timestamp && row.timestamp < repair!.timestamp,
      );
      expect(between).toHaveLength(0);
    }
    measuredHours.sort((a, b) => a - b);
    expect(measuredHours).toEqual([...XIAOMAN_TRUTH.conflicts.durationsHours].sort((a, b) => a - b));
  });
});

describe("表情包", () => {
  it("closes happy-playful/melancholy rounds with a sticker and never uses one when distant", () => {
    const sticker = (label: string) => records.filter((row) => row.kind === "sticker" && row.content === label);
    expect(sticker(XIAOMAN_TRUTH.stickerPeek).length).toBeGreaterThan(0);
    expect(sticker(XIAOMAN_TRUTH.stickerSigh).length).toBeGreaterThan(0);
    expect(records.filter((row) => row.kind === "sticker" && row.truth.state === "distant")).toHaveLength(0);

    const bursts = new Map<number, FixtureRecord[]>();
    for (const row of records) {
      if (row.truth.burstId == null) continue;
      const list = bursts.get(row.truth.burstId) ?? [];
      list.push(row);
      bursts.set(row.truth.burstId, list);
    }
    const lastOf = (group: FixtureRecord[]) =>
      [...group].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime()).at(-1);

    let happyPlayfulRounds = 0;
    let happyPlayfulClosed = 0;
    let melancholyRounds = 0;
    let melancholyClosed = 0;
    const closing: FixtureRecord[] = [];
    for (const group of bursts.values()) {
      const state = group[0]!.truth.state;
      const last = lastOf(group)!;
      if (state === "happy" || state === "playful") {
        happyPlayfulRounds++;
        if (last.kind === "sticker" && last.content === XIAOMAN_TRUTH.stickerPeek) {
          happyPlayfulClosed++;
          closing.push(last);
        }
      }
      if (state === "melancholy") {
        melancholyRounds++;
        if (last.kind === "sticker" && last.content === XIAOMAN_TRUTH.stickerSigh) {
          melancholyClosed++;
          closing.push(last);
        }
      }
    }
    // "收尾" means the sticker is the last message of the round, not
    // merely somewhere in it.
    expectRate(happyPlayfulClosed, happyPlayfulRounds, XIAOMAN_TRUTH.stickerHappyPlayful);
    expectRate(melancholyClosed, melancholyRounds, XIAOMAN_TRUTH.stickerMelancholy);
    // Every sticker belongs to a burst and is its last row.
    const stickerRows = records.filter((row) => row.kind === "sticker");
    expect(stickerRows.every((row) => row.truth.burstId != null)).toBe(true);
    for (const row of stickerRows) {
      expect(lastOf(bursts.get(row.truth.burstId!)!)!.timestamp.getTime()).toBe(row.timestamp.getTime());
    }
  });
});

describe("语音", () => {
  it("makes 5% of warm TA turns a 12-second voice note with a transcript", () => {
    /*
     * A voice note replaces the round's own reply, so the denominator is
     * the ordinary warm turns where that branch can run. Morning,
     * Wednesday and goodnight turns are not candidates and used to
     * inflate the denominator.
     *
     * `locked` rows are the designed special lines (the 晚安/早/在吗
     * replies, follow-ups, typo corrections, conflict preludes, and the
     * fixed lines for people/facts/words). They are not drawn from the
     * ordinary branch either, so counting them would understate the rate —
     * P0.5's independent re-verification found the special rows still in
     * this denominator. The voice notes themselves are `locked` too, and
     * they stay in the denominator: the 5% draw happens before they replace
     * the round's reply.
     */
    const warmTurns = records.filter(
      (row) =>
        row.role === "assistant" &&
        row.truth.state === "warm" &&
        (row.truth.slot === "evening" || row.truth.slot === "noon" || row.truth.slot === "afternoon") &&
        (row.truth.burstIndex == null || row.truth.burstIndex === 0) &&
        row.kind !== "sticker" &&
        (!row.truth.locked || row.kind === "voice"),
    );
    const voices = records.filter((row) => row.kind === "voice");
    expect(voices.every((row) => row.truth.state === "warm")).toBe(true);
    expectRate(voices.length, Math.max(warmTurns.length, 1), 0.05, 0.03);
    for (const row of voices) {
      expect(row.content).toBe("[voice:12]");
      expect(typeof row.meta?.transcript).toBe("string");
    }
  });
});

describe("通话", () => {
  it("has 20 Sunday-evening calls, mostly incoming", () => {
    const calls = records.filter((row) => row.kind === "call");
    expect(calls).toHaveLength(20);
    for (const row of calls) {
      const w = wallClock(row.timestamp);
      expect(w.weekday).toBe(0);
      expect(w.hour).toBe(21);
      const duration = Number(row.meta?.durationSec);
      expect(duration).toBeGreaterThanOrEqual(600);
      expect(duration).toBeLessThanOrEqual(3600);
    }
    expectRate(calls.filter((row) => row.meta?.direction === "in").length, calls.length, 0.7);
    expect(calls.every((row) => row.truth.conflictEpisode == null)).toBe(true);
  });
});

describe("事实", () => {
  it("records the birthday line and the cafe line on the designed days, in the right mouth", () => {
    const birthday = records.find((row) => row.content === XIAOMAN_TRUTH.factBirthday.text);
    expect(birthday).toBeTruthy();
    expect(birthday!.role).toBe("assistant");
    expect(ymd(birthday!)).toBe(2022_04_02);
    const cafe = records.find((row) => row.content.includes("拾光咖啡"));
    expect(cafe).toBeTruthy();
    expect(cafe!.role).toBe("user");
    expect(ymd(cafe!)).toBe(2022_03_12);
  });
});

describe("人物", () => {
  it("mentions 琪琪 12 times and 我妈 9 times", () => {
    expect(taText().filter((row) => row.content.includes("琪琪"))).toHaveLength(12);
    expect(taText().filter((row) => row.content.includes("我妈"))).toHaveLength(9);
  });
});

describe("喜恶", () => {
  it("says she hates cilantro three times and likes the sea four", () => {
    expect(taText().filter((row) => row.content.includes("讨厌香菜"))).toHaveLength(3);
    expect(taText().filter((row) => row.content.includes("喜欢海"))).toHaveLength(4);
  });
});

describe("专属词", () => {
  it("uses 咕咕 15 times", () => {
    expect(records.filter((row) => row.content.includes("咕咕"))).toHaveLength(15);
  });
});

describe("不懂的事", () => {
  it("lets me mention stocks six times and has TA never say the words", () => {
    const userStock = records.filter(
      (row) => row.role === "user" && (row.content.includes("股票") || row.content.includes("基金")),
    );
    expect(userStock).toHaveLength(6);
    expect(taText().filter((row) => row.content.includes("股票") || row.content.includes("基金"))).toHaveLength(0);
    expect(taText().filter((row) => row.content === XIAOMAN_TRUTH.stockReply).length).toBe(6);
  });
});

describe("未结的事", () => {
  it("leaves one noodle plan from them and one movie plan from me, both unfinished", () => {
    const noodle = records.filter((row) => row.content === XIAOMAN_TRUTH.openLoopTa);
    expect(noodle).toHaveLength(1);
    expect(noodle[0]!.role).toBe("assistant");
    const movie = records.filter((row) => row.content === XIAOMAN_TRUTH.openLoopUser);
    expect(movie).toHaveLength(1);
    expect(movie[0]!.role).toBe("user");
  });
});

describe("多点消息", () => {
  it("has 40 three-thing user lines, and TA answers 80% of them with only the last thing", () => {
    const multi = records.filter((row) => row.truth.ritual === "multi-point" && row.role === "user");
    expect(multi).toHaveLength(40);
    const replies = records.filter((row) => row.truth.ritual === "multi-point" && row.role === "assistant");
    expect(replies).toHaveLength(40);
    const lastOnly = replies.filter((row) => row.content.includes("伞") && !row.content.includes("吃饭"));
    expectRate(lastOnly.length, multi.length, XIAOMAN_TRUTH.multiPoint.lastOnlyRate);
  });
});

describe("追一句", () => {
  it("follows up 30 times after 6–12 minutes with 人呐 or ？", () => {
    const follows = taText().filter((row) => row.truth.ritual === "follow-up");
    expect(follows.length).toBe(30);
    expectRate(follows.filter((row) => row.content === "人呐").length, follows.length, 0.7);
    expectRate(follows.filter((row) => row.content === "？").length, follows.length, 0.3);
    for (const follow of follows) {
      const earlier = records
        .filter((row) => row.truth.sceneId === follow.truth.sceneId && row.timestamp < follow.timestamp && row.id !== follow.id)
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
      const previousTa = earlier.find((row) => row.role === "assistant");
      expect(previousTa).toBeTruthy();
      const gapMin = (follow.timestamp.getTime() - previousTa!.timestamp.getTime()) / 60_000;
      expect(gapMin).toBeGreaterThanOrEqual(6);
      expect(gapMin).toBeLessThanOrEqual(12);
      const userBetween = earlier.filter(
        (row) => row.role === "user" && row.timestamp > previousTa!.timestamp && row.timestamp < follow.timestamp,
      );
      expect(userBetween).toHaveLength(0);
    }
  });
});

describe("改错字", () => {
  it("corrects a typo six times within 30 seconds", () => {
    const typos = taText().filter((row) => row.truth.ritual === "typo");
    const fixes = taText().filter((row) => row.truth.ritual === "typo-fix");
    expect(typos).toHaveLength(6);
    expect(fixes).toHaveLength(6);
    for (const typo of typos) {
      const fix = fixes.find((row) => Math.abs(row.timestamp.getTime() - typo.timestamp.getTime() - 30_000) < 2);
      expect(fix).toBeTruthy();
      expect(fix!.content.startsWith("*")).toBe(true);
    }
  });
});

describe("伤人的话", () => {
  it("has no harm by default and five belittling lines when asked", () => {
    const harm = (rows: FixtureRecord[]) =>
      rows.filter((row) => XIAOMAN_TRUTH.harm.lines.some((line) => row.content === line));
    expect(harm(records)).toHaveLength(0);
    expect(harm(buildXiaomanRecords({ withHarm: true }))).toHaveLength(5);
  });
});

describe("seed robustness", () => {
  it("builds for any seed, including the ones whose conflict used to overflow", () => {
    for (const seed of ["xiaoman", "alpha", "beta", "speed", "h98", "h186", "h439", "h476", "seed-37", "", "😀", "0", "1"]) {
      expect(() => buildXiaomanRecords({ seed }), seed).not.toThrow();
    }
  }, 15_000);
});

describe("the harmful variant", () => {
  it("adds five belittling lines without moving the clock", () => {
    const harmful = buildXiaomanRecords({ withHarm: true });
    expect(harmful).toHaveLength(records.length);
    expect(harmful.filter((row) => XIAOMAN_TRUTH.harm.lines.includes(row.content))).toHaveLength(5);
    const stamps = (rows: FixtureRecord[]) => rows.map((row) => row.timestamp.getTime()).sort((a, b) => a - b);
    expect(stamps(harmful)).toEqual(stamps(records));
    const count = (rows: FixtureRecord[]) => {
      const map = new Map<string, number>();
      for (const row of rows) map.set(row.content, (map.get(row.content) ?? 0) + 1);
      return map;
    };
    const base = count(records);
    const changedBase: string[] = [];
    const added: string[] = [];
    const withHarmCounts = count(harmful);
    for (const [text, n] of withHarmCounts) {
      const was = base.get(text) ?? 0;
      if (n > was) added.push(...Array.from({ length: n - was }, () => text));
      if (n < was) changedBase.push(...Array.from({ length: was - n }, () => text));
    }
    expect(added.sort()).toEqual([...XIAOMAN_TRUTH.harm.lines].sort());
    expect(changedBase).toHaveLength(5);
  });
});

describe("the design constants", () => {
  it("are the handbook's numbers, not just the generator's own constants", () => {
    expect({
      span: XIAOMAN_TRUTH.span,
      silence: XIAOMAN_TRUTH.silence,
      activeDays: XIAOMAN_TRUTH.activeDays,
      roundsPerMainScene: XIAOMAN_TRUTH.roundsPerMainScene,
      taLinesMin: XIAOMAN_TRUTH.taLinesMin,
      taLinesApprox: XIAOMAN_TRUTH.taLinesApprox,
      slotEvening: XIAOMAN_TRUTH.slotEvening,
      slotNoon: XIAOMAN_TRUTH.slotNoon,
      states: XIAOMAN_TRUTH.states,
      taMedianP1: XIAOMAN_TRUTH.taMedianP1,
      taMedianP2: XIAOMAN_TRUTH.taMedianP2,
      taP95Max: XIAOMAN_TRUTH.taP95Max,
      distantPeriodEnd: XIAOMAN_TRUTH.distantPeriodEnd,
      distantMaxChars: XIAOMAN_TRUTH.distantMaxChars,
      particles: XIAOMAN_TRUTH.particles,
      laughRate: XIAOMAN_TRUTH.laughRate,
      addressRate: XIAOMAN_TRUTH.addressRate,
      burst: XIAOMAN_TRUTH.burst,
      burstGapMsPerChar: XIAOMAN_TRUTH.burstGapMsPerChar,
      burstGapTolerance: XIAOMAN_TRUTH.burstGapTolerance,
      replyMedianEveningSec: XIAOMAN_TRUTH.replyMedianEveningSec,
      replyMedianDaySec: XIAOMAN_TRUTH.replyMedianDaySec,
      replySigma: XIAOMAN_TRUTH.replySigma,
      sleep: XIAOMAN_TRUTH.sleep,
      wednesdayQuiet: XIAOMAN_TRUTH.wednesdayQuiet,
      wednesdayWeeksMin: XIAOMAN_TRUTH.wednesdayWeeksMin,
      goodnight: XIAOMAN_TRUTH.goodnight,
      morning: XIAOMAN_TRUTH.morning,
      zaime: XIAOMAN_TRUTH.zaime,
      questionP1: XIAOMAN_TRUTH.questionP1,
      questionP2: XIAOMAN_TRUTH.questionP2,
      affectionP1: XIAOMAN_TRUTH.affectionP1,
      acknowledgeP2: XIAOMAN_TRUTH.acknowledgeP2,
      conflicts: XIAOMAN_TRUTH.conflicts,
      stickerHappyPlayful: XIAOMAN_TRUTH.stickerHappyPlayful,
      stickerMelancholy: XIAOMAN_TRUTH.stickerMelancholy,
      voiceWarmRate: XIAOMAN_TRUTH.voiceWarmRate,
      calls: XIAOMAN_TRUTH.calls,
      people: XIAOMAN_TRUTH.people,
      likes: XIAOMAN_TRUTH.likes,
      wordGugu: XIAOMAN_TRUTH.wordGugu,
      stockMentions: XIAOMAN_TRUTH.stockMentions,
      multiPoint: XIAOMAN_TRUTH.multiPoint,
      followUp: XIAOMAN_TRUTH.followUp,
      typos: XIAOMAN_TRUTH.typos,
      harmCount: XIAOMAN_TRUTH.harm.count,
    }).toEqual({
      span: { from: "2022-03-01", to: "2024-10-31" },
      silence: { from: "2023-06-10", to: "2023-07-04", days: 25 },
      activeDays: 160,
      roundsPerMainScene: 10,
      taLinesMin: 1400,
      taLinesApprox: 3200,
      slotEvening: 0.7,
      slotNoon: 0.2,
      states: { warm: 0.45, happy: 0.2, playful: 0.15, distant: 0.1, nostalgic: 0.05, melancholy: 0.05 },
      taMedianP1: 10,
      taMedianP2: 6,
      taP95Max: 24,
      distantPeriodEnd: 0.9,
      distantMaxChars: 4,
      particles: { 呀: 0.3, 啦: 0.2, 嘛: 0.1 },
      laughRate: 0.12,
      addressRate: 0.2,
      burst: { 1: 0.4, 2: 0.4, 3: 0.2 },
      burstGapMsPerChar: 200,
      burstGapTolerance: 0.2,
      replyMedianEveningSec: 40,
      replyMedianDaySec: 120,
      replySigma: 0.8,
      sleep: { fromHour: 0, fromMinute: 0, toHour: 7, toMinute: 30 },
      wednesdayQuiet: { fromHour: 14, toHour: 16 },
      wednesdayWeeksMin: 20,
      goodnight: { 晚安: 0.6, 安: 0.25, 睡啦: 0.15, min: 100 },
      morning: { 早呀: 0.7, 早: 0.3, min: 40 },
      zaime: { 在: 0.8, 咋啦: 0.2, min: 30 },
      questionP1: 0.2,
      questionP2: 0.03,
      affectionP1: 0.25,
      acknowledgeP2: 0.3,
      conflicts: {
        count: 6,
        durationsHours: [3, 4, 5, 5, 6, 8],
        taRepair: 4,
        userRepair: 2,
        triggerUser: "嗯",
        triggerTa: "就嗯？",
        taReconcile: "好啦 不气了",
        userReconcile: "对不起嘛",
        taAfterUser: "哼",
        reconcileFromHour: 15,
        reconcileToHour: 21,
      },
      stickerHappyPlayful: 0.25,
      stickerMelancholy: 0.3,
      voiceWarmRate: 0.05,
      calls: { count: 20, minSec: 600, maxSec: 3600, incomingRate: 0.7, sundayHour: 21 },
      people: { 琪琪: 12, 我妈: 9 },
      likes: { 讨厌香菜: 3, 喜欢海: 4 },
      wordGugu: 15,
      stockMentions: 6,
      multiPoint: { count: 40, lastOnlyRate: 0.8 },
      followUp: { count: 30, 人呐: 0.7, "？": 0.3, minMin: 6, maxMin: 12 },
      typos: 6,
      harmCount: 5,
    });
  });
});

describe("group fixture", () => {
  const group = buildGroupFixture();
  const stats = measureGroup(group);

  it("measures to the designed group numbers", () => {
    expect(stats).not.toBeNull();
    expect(stats!.samples).toBe(GROUP_FIXTURE_TRUTH.samples);
    expect(stats!.samples).toBeGreaterThanOrEqual(40);
    expect(Math.abs(stats!.afterMeRate - GROUP_FIXTURE_TRUTH.afterMeRate)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(stats!.afterOthersRate - GROUP_FIXTURE_TRUTH.afterOthersRate)).toBeLessThanOrEqual(
      0.1,
    );
    expect(Math.abs(stats!.lengthMedian - GROUP_FIXTURE_TRUTH.lengthMedian)).toBeLessThanOrEqual(1);
    expect(
      Math.abs(stats!.gapMedianMessages - GROUP_FIXTURE_TRUTH.gapMedianMessages),
    ).toBeLessThanOrEqual(1);
    // The log is built so these are exact, not merely inside the tolerance.
    expect(stats!.afterMeRate).toBeCloseTo(0.6, 10);
    expect(stats!.afterOthersRate).toBeCloseTo(0.2, 10);
    expect(stats!.lengthMedian).toBe(5);
    expect(stats!.gapMedianMessages).toBe(5);
  });

  it("is deterministic across two builds", () => {
    const again = buildGroupFixture();
    expect(again.map((row) => row.id)).toEqual(group.map((row) => row.id));
    expect(again.map((row) => row.role)).toEqual(group.map((row) => row.role));
    expect(again.map((row) => row.speaker)).toEqual(group.map((row) => row.speaker));
    expect(again.map((row) => row.content)).toEqual(group.map((row) => row.content));
    expect(again.map((row) => row.timestamp.getTime())).toEqual(
      group.map((row) => row.timestamp.getTime()),
    );
  });

  it("has three speakers and about three hundred lines", () => {
    expect(group.length).toBeGreaterThanOrEqual(280);
    expect(group.length).toBeLessThanOrEqual(320);
    const speakers = new Set(group.map((row) => row.speaker));
    expect(speakers.size).toBe(3);
    expect(speakers).toEqual(new Set([XIAOMAN_USER_NAME, XIAOMAN_NAME, "琪琪"]));
    expect(group.every((row) => row.kind === "text")).toBe(true);
    // The clock is the Shanghai wall clock, and the log moves forward.
    expect(wallClock(group[0]!.timestamp)).toMatchObject({ year: 2024, month: 1, day: 8, hour: 19 });
    for (let index = 1; index < group.length; index += 1) {
      expect(group[index]!.timestamp.getTime()).toBeGreaterThan(group[index - 1]!.timestamp.getTime());
    }
  });

  it("returns null at thirty-nine persona lines", () => {
    const persona = group.filter((row) => row.role === "assistant");
    expect(persona.length).toBeGreaterThan(39);
    expect(measureGroup(persona.slice(0, 39))).toBeNull();
    const handBuilt = Array.from({ length: 39 }, () => ({
      role: "assistant",
      content: "在的呀",
      kind: "text",
    }));
    expect(measureGroup(handBuilt)).toBeNull();
  });
});
