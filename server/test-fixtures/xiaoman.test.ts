import { describe, expect, it } from "vitest";
import { parseTranscriptMessages } from "../skill-engine/micro-rules";
import { renderFixture } from "./render";
import {
  buildGroupFixture,
  buildXiaomanRecords,
  charCount,
  deriveXiaomanTruth,
  wallClock,
  XIAOMAN_DEFAULT_SEED,
  XIAOMAN_NAME,
  XIAOMAN_TRUTH,
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

  it("builds in under 500ms", () => {
    const started = performance.now();
    buildXiaomanRecords({ seed: "speed" });
    expect(performance.now() - started).toBeLessThan(500);
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
  it("has about 160 active days and at least 1400 TA lines", () => {
    const mainDays = new Set(
      records
        .filter((row) => row.truth.slot === "evening" || row.truth.slot === "noon" || row.truth.slot === "afternoon")
        .map((row) => ymd(row)),
    );
    expect(mainDays.size).toBe(XIAOMAN_TRUTH.activeDays);
    expect(records.filter((row) => row.role === "assistant").length).toBeGreaterThanOrEqual(XIAOMAN_TRUTH.taLinesMin);
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
  it("formats every timestamp to the second in Asia/Shanghai", () => {
    for (const row of records.slice(0, 20).concat(records.slice(-20))) {
      const w = wallClock(row.timestamp);
      expect(w.second).toBeGreaterThanOrEqual(0);
      expect(w.second).toBeLessThan(60);
    }
  });
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
    expect(taText().filter((row) => row.content.includes("呢") && row.content !== "人呢").length).toBe(0);
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
  it("only uses ... for ellipsis, never ～, never emoji", () => {
    expect(records.filter((row) => row.content.includes("…")).length).toBe(0);
    expect(records.filter((row) => row.content.includes("。。。")).length).toBe(0);
    expect(records.filter((row) => row.content.includes("～")).length).toBe(0);
    expect(records.filter((row) => /\p{Extended_Pictographic}/u.test(row.content)).length).toBe(0);
  });
});

describe("称呼", () => {
  it("says 树树 on a fifth of TA lines and 陈树 when distant", () => {
    expectRate(taText().filter((row) => row.content.includes("树树")).length, taText().length, 0.2);
    const distant = taText().filter((row) => row.truth.state === "distant");
    expect(distant.filter((row) => row.content.includes("树树")).length).toBe(0);
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
  it("uses peek/sigh stickers in happy-playful/melancholy rounds and never when distant", () => {
    const sticker = (label: string) => records.filter((row) => row.kind === "sticker" && row.content === label);
    expect(sticker(XIAOMAN_TRUTH.stickerPeek).length).toBeGreaterThan(0);
    expect(sticker(XIAOMAN_TRUTH.stickerSigh).length).toBeGreaterThan(0);
    expect(records.filter((row) => row.kind === "sticker" && row.truth.state === "distant")).toHaveLength(0);
    const burstRounds = (state: "happy" | "playful" | "melancholy") => {
      const ids = new Set<number>();
      for (const row of records) {
        if (row.truth.state !== state || row.truth.burstId == null) continue;
        ids.add(row.truth.burstId);
      }
      return ids.size;
    };
    const happyPlayfulRounds = burstRounds("happy") + burstRounds("playful");
    expectRate(
      sticker(XIAOMAN_TRUTH.stickerPeek).length,
      happyPlayfulRounds,
      XIAOMAN_TRUTH.stickerHappyPlayful,
    );
    expectRate(
      sticker(XIAOMAN_TRUTH.stickerSigh).length,
      burstRounds("melancholy"),
      XIAOMAN_TRUTH.stickerMelancholy,
    );
  });
});

describe("语音", () => {
  it("makes 5% of warm TA turns a 12-second voice note with a transcript", () => {
    const warmTurns = records.filter(
      (row) =>
        row.role === "assistant" &&
        row.truth.state === "warm" &&
        (row.truth.burstIndex === 0 || row.kind === "voice"),
    );
    const voices = records.filter((row) => row.kind === "voice");
    expectRate(voices.length, Math.max(warmTurns.length, 1), 0.05, 0.05);
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
  });
});

describe("事实", () => {
  it("records the birthday line and the cafe line on the designed days", () => {
    const birthday = records.find((row) => row.content === XIAOMAN_TRUTH.factBirthday.text);
    expect(birthday).toBeTruthy();
    expect(ymd(birthday!)).toBe(2022_04_02);
    const cafe = records.find((row) => row.content.includes("拾光咖啡"));
    expect(cafe).toBeTruthy();
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
  it("leaves one noodle plan and one movie plan unfinished", () => {
    expect(records.filter((row) => row.content === XIAOMAN_TRUTH.openLoopTa)).toHaveLength(1);
    expect(records.filter((row) => row.content === XIAOMAN_TRUTH.openLoopUser)).toHaveLength(1);
  });
});

describe("多点消息", () => {
  it("has 40 three-thing user lines, and TA usually takes only the last", () => {
    const multi = records.filter((row) => row.truth.ritual === "multi-point" && row.role === "user");
    expect(multi).toHaveLength(40);
    const replies = records.filter((row) => row.truth.ritual === "multi-point" && row.role === "assistant");
    expectRate(replies.filter((row) => row.content.includes("伞") && !row.content.includes("吃饭")).length, replies.length, 0.8);
  });
});

describe("追一句", () => {
  it("follows up 30 times after 6–12 minutes with 人呢 or ？", () => {
    const follows = taText().filter((row) => row.truth.ritual === "follow-up");
    expect(follows.length).toBe(30);
    expectRate(follows.filter((row) => row.content === "人呢").length, follows.length, 0.7);
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

describe("group fixture stub", () => {
  it("has three speakers and about 300 lines", () => {
    const group = buildGroupFixture();
    expect(group.length).toBeGreaterThanOrEqual(280);
    expect(group.length).toBeLessThanOrEqual(320);
    expect(new Set(group.map((row) => row.speaker)).size).toBe(3);
  });
});
