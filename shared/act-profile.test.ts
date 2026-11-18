import { describe, expect, it } from "vitest";
import { seededRandom } from "../server/_core/behavior-profile";
import { isSpeechAct, isUserAct, labelUserActByRule } from "./speech-acts";
import { isTextRecord } from "./records";
import { buildXiaomanRecords } from "../server/test-fixtures/xiaoman";
import { buildActProfile } from "../server/skill-engine/acts";
import {
  ACT_MIN_SAMPLES,
  correctActCount,
  countsForCondition,
  hasActDistribution,
  normalizeActProfile,
  sampleAct,
  type ActProfile,
} from "./act-profile";

function profile(overrides: Partial<ActProfile> = {}): ActProfile {
  const unconditional = {
    answer: 20,
    acknowledge: 10,
    tease: 5,
    silence: 5,
    comfort: 0,
    affection: 0,
    advise: 0,
    logistics: 0,
    deflect: 0,
    repair: 0,
    share: 0,
  };
  return {
    samples: ACT_MIN_SAMPLES,
    unconditional,
    buckets: [
      {
        asking: true,
        counts: { answer: 12, acknowledge: 2 },
        samples: 14,
      },
    ],
    ...overrides,
  };
}

describe("sampling an action", () => {
  it("is stable for a fixed seed", () => {
    const first = sampleAct(profile(), {
      asking: false,
      emotion: "warm",
      dayPart: "day",
      relationshipPhase: "stable",
    }, { rng: () => 0.1 });
    const second = sampleAct(profile(), {
      asking: false,
      emotion: "warm",
      dayPart: "day",
      relationshipPhase: "stable",
    }, { rng: () => 0.1 });
    expect(first?.act).toBe(second?.act);
  });

  it("drops silence when the timing switch is off, and remembers the first draw", () => {
    const thin = profile({
      unconditional: { silence: 100, answer: 1 },
      samples: 101,
      buckets: [],
    });
    const draws: Array<() => number> = [() => 0.01, () => 0.99];
    let i = 0;
    const sampled = sampleAct(
      thin,
      { asking: false, emotion: "warm", dayPart: "day", relationshipPhase: "stable" },
      { dropSilence: true, rng: () => draws[Math.min(i++, draws.length - 1)]() },
    );
    expect(sampled?.drawn).toBe("silence");
    expect(sampled?.act).not.toBe("silence");
    expect(sampled?.resampled).toBe(true);
  });

  it("does not sample from a rumour", () => {
    expect(
      hasActDistribution(normalizeActProfile({ samples: 3, unconditional: { answer: 3 } })),
    ).toBe(false);
    expect(
      sampleAct(
        { samples: 3, unconditional: { answer: 3 }, buckets: [] },
        { asking: true, emotion: "warm", dayPart: "day", relationshipPhase: "initial" },
      ),
    ).toBeNull();
  });

  it("falls back from a thin bucket and says so", () => {
    const { fallback } = countsForCondition(profile({
      buckets: [{ asking: true, emotion: "distant", counts: { tease: 1 }, samples: 1 }],
    }), {
      asking: true,
      emotion: "distant",
      dayPart: "night",
      relationshipPhase: "closing",
    });
    expect(fallback).toBe(true);
  });

  it("subtracts one from a hand-corrected action and marks the profile edited", () => {
    const corrected = correctActCount(profile(), "answer");
    expect(corrected.unconditional.answer).toBe(19);
    expect(corrected.edited).toBe(true);
    expect(corrected.samples).toBe(39);
    const floored = correctActCount(profile({ unconditional: { tease: 0, answer: 40 }, samples: 40 }), "tease");
    expect(floored.unconditional.tease).toBe(0);
  });
});

describe("adjacency pairs", () => {
  const asking = {
    asking: true,
    emotion: "warm",
    dayPart: "day" as const,
    relationshipPhase: "stable",
    userAct: "ask" as const,
  };

  it("uses byUserAct.ask when that bucket has twenty samples", () => {
    const decided = countsForCondition(
      profile({ byUserAct: { ask: { answer: 16, tease: 4 } } }),
      asking,
    );
    expect(decided.via).toBe("userAct");
    expect(decided.counts).toEqual({ answer: 16, tease: 4 });
    expect(decided.fallback).toBe(false);
  });

  it("falls back to the older buckets when byUserAct.ask has only five samples", () => {
    const decided = countsForCondition(
      profile({ byUserAct: { ask: { answer: 5 } } }),
      asking,
    );
    expect(decided.via).toBe("bucket");
    expect(decided.counts).toEqual({ answer: 12, acknowledge: 2 });
  });

  it("prefers the mood-split pair when that bucket is thick enough", () => {
    const decided = countsForCondition(
      profile({
        byUserAct: { ask: { answer: 20 } },
        byUserActEmotion: [
          { userAct: "ask", emotion: "warm", counts: { tease: 10 }, samples: 10 },
        ],
      }),
      asking,
    );
    expect(decided.via).toBe("userAct+emotion");
    expect(decided.counts).toEqual({ tease: 10 });
  });

  it("keeps sampling identical on an old profile that has no adjacency tables", () => {
    const old = profile();
    const normalized = normalizeActProfile({
      samples: old.samples,
      unconditional: old.unconditional,
      buckets: old.buckets,
    });
    expect(normalized?.byUserAct).toBeUndefined();
    expect(normalized?.byUserActEmotion).toBeUndefined();
    const expected = [
      "answer","answer","answer","answer","answer","answer","answer","answer","answer","answer",
      "answer","answer","answer","answer","answer","answer","acknowledge","answer","answer","answer",
      "answer","answer","answer","acknowledge","answer","acknowledge","acknowledge","answer","acknowledge","answer",
      "answer","answer","answer","answer","answer","answer","answer","answer","answer","answer",
      "answer","answer","answer","answer","acknowledge","answer","answer","answer","answer","answer",
    ];
    const condition = {
      asking: true,
      emotion: "warm",
      dayPart: "day" as const,
      relationshipPhase: "stable",
      userAct: "ask" as const,
    };
    for (let i = 0; i < 50; i++) {
      const sampled = sampleAct(normalized!, condition, { rng: seededRandom(`b41-old:${i}`) });
      expect(sampled?.act).toBe(expected[i]);
      expect(sampled?.via === "bucket" || sampled?.via === "unconditional").toBe(true);
    }
  });

  it("puts the fixture's ask→answer and acknowledge→tease shares inside the designed bands", async () => {
    const fixture = buildXiaomanRecords();
    const records = fixture.map((row) => {
      const act =
        row.role === "assistant" && isSpeechAct(row.truth.act)
          ? row.truth.act
          : row.role === "user"
            ? isUserAct(row.truth.userAct)
              ? row.truth.userAct
              : labelUserActByRule(row.content)
            : null;
      return {
        id: row.id,
        role: row.role,
        content: row.content,
        kind: row.kind,
        timestamp: row.timestamp,
        speaker: row.speaker,
        act,
        emotion: row.role === "assistant" ? row.truth.state : null,
      };
    });
    const designed = designedAdjacency(records);
    const profile = await buildActProfile({
      messages: records,
      userId: 1,
      locale: "zh",
      timezone: "Asia/Shanghai",
    });
    expect(profile?.byUserAct?.ask).toBeTruthy();
    expect(profile?.byUserAct?.acknowledge).toBeTruthy();
    const askTotal = sumCounts(profile!.byUserAct!.ask!);
    const ackTotal = sumCounts(profile!.byUserAct!.acknowledge!);
    expect(Math.abs((profile!.byUserAct!.ask!.answer ?? 0) / askTotal - designed.askAnswer)).toBeLessThanOrEqual(0.08);
    expect(Math.abs((profile!.byUserAct!.acknowledge!.tease ?? 0) / ackTotal - designed.ackTease)).toBeLessThanOrEqual(0.1);
  });
});

function sumCounts(counts: Record<string, number | undefined>): number {
  return Object.values(counts).reduce<number>((sum, n) => sum + (n ?? 0), 0);
}

function designedAdjacency(
  records: Array<{
    role: string;
    content: string;
    kind?: string | null;
    act?: string | null;
  }>,
): { askAnswer: number; ackTease: number } {
  let prev: string | null = null;
  let ask = 0;
  let askAnswer = 0;
  let ack = 0;
  let ackTease = 0;
  for (const row of records) {
    if (!isTextRecord(row)) continue;
    if (row.role === "user") {
      prev = isUserAct(row.act) ? row.act : null;
      continue;
    }
    if (row.role !== "assistant" || !isSpeechAct(row.act) || !prev) continue;
    if (prev === "ask") {
      ask += 1;
      if (row.act === "answer") askAnswer += 1;
    }
    if (prev === "acknowledge") {
      ack += 1;
      if (row.act === "tease") ackTease += 1;
    }
  }
  return {
    askAnswer: ask === 0 ? 0 : askAnswer / ask,
    ackTease: ack === 0 ? 0 : ackTease / ack,
  };
}
