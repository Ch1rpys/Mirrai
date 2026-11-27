import { describe, expect, it } from "vitest";
import {
  arrangeBlindGroups,
  eligibleBlindScores,
  expectedMessageIdsFromCases,
  exportBlindRecord,
  feedbackRowsFromBlindSessions,
  hashBlindToken,
  pickBlindGroups,
  publicBlindGroups,
  summariseBlindSitting,
  type BlindStoredGroup,
} from "./blind";

const ORIGINAL = "我今天去了拾光咖啡喝桂花拿铁";

function line(caseId: number, text: string, fake = `${text}。`): {
  caseId: number;
  expectedText: string;
  generatedText: string;
} {
  return { caseId, expectedText: text, generatedText: fake };
}

describe("the blind pairs", () => {
  it("drops lines that are too short or too long", () => {
    const kept = eligibleBlindScores([
      line(1, "嗯"),
      line(2, ORIGINAL),
      line(3, "字".repeat(41)),
    ]);
    expect(kept.map((row) => row.caseId)).toEqual([2]);
  });

  it("prefers the earlier half when the sitter is the person themselves", () => {
    const scores = Array.from({ length: 24 }, (_, i) =>
      line(i, `这是一句够长的话${i}`),
    );
    const occurredAt = new Map(
      scores.map((score) => [score.caseId, new Date(2020, 0, 1 + score.caseId)]),
    );
    const picked = pickBlindGroups(scores, {
      groups: 12,
      subject: "self",
      occurredAt,
      seed: "self-early",
    });
    expect(picked).toHaveLength(12);
    expect(picked.every((group) => group.caseId < 12)).toBe(true);
  });

  it("refuses to pick when there are not enough eligible pairs", () => {
    const picked = pickBlindGroups([line(1, ORIGINAL)], {
      groups: 12,
      subject: "friend",
      seed: "few",
    });
    expect(picked).toEqual([]);
  });

  it("flips a pair the same way for the same sitting", () => {
    const groups: BlindStoredGroup[] = [
      { caseId: 1, real: ORIGINAL, fake: "分身写的另一句", realFirst: true },
    ];
    expect(arrangeBlindGroups(groups, 7)).toEqual(arrangeBlindGroups(groups, 7));
  });

  it("hides which line is real in the public payload", () => {
    const groups: BlindStoredGroup[] = [
      { caseId: 1, real: ORIGINAL, fake: "分身写的另一句", realFirst: false },
    ];
    expect(publicBlindGroups(groups)).toEqual([
      { first: "分身写的另一句", second: ORIGINAL },
    ]);
  });
});

describe("the sitting's score", () => {
  const groups: BlindStoredGroup[] = Array.from({ length: 3 }, (_, i) => ({
    caseId: i,
    real: `真话${i}够长了`,
    fake: `假话${i}够长了`,
    realFirst: i !== 1,
  }));

  it("makes the three rates add up to one", () => {
    const summary = summariseBlindSitting(groups, [
      { group: 0, pick: "first", seconds: 2, reason: "word" },
      { group: 1, pick: "first", seconds: 4, reason: "mood" },
      { group: 2, pick: "unsure", seconds: 6 },
    ]);
    expect(summary.n).toBe(3);
    expect(summary.pickedReal + summary.pickedPersona + summary.unsure).toBeCloseTo(1, 10);
    expect(summary.medianSeconds).toBe(4);
    expect(summary.reasons).toEqual({ word: 1, mood: 1 });
  });

  it("writes a record that does not contain the original line", () => {
    const markdown = exportBlindRecord({
      personaId: 3,
      subject: "self",
      startedAt: "2026-11-17T00:00:00.000Z",
      groups,
      answers: [
        { group: 0, pick: "first", seconds: 3, reason: "word" },
        { group: 1, pick: "unsure", seconds: 5 },
        { group: 2, pick: "second", seconds: 4 },
      ],
      summary: summariseBlindSitting(groups, [
        { group: 0, pick: "first", seconds: 3, reason: "word" },
        { group: 1, pick: "unsure", seconds: 5 },
        { group: 2, pick: "second", seconds: 4 },
      ]),
    });
    expect(markdown).toContain("hitRate:");
    expect(markdown).toContain("pickedReal:");
    expect(markdown).toContain("subject: self");
    expect(markdown).not.toContain("真话0够长了");
    expect(markdown).not.toContain("假话0够长了");
  });

  it("hashes the invite token rather than storing it", () => {
    expect(hashBlindToken("abc")).toHaveLength(64);
    expect(hashBlindToken("abc")).toBe(hashBlindToken("abc"));
    expect(hashBlindToken("abc")).not.toBe(hashBlindToken("abd"));
  });
});

describe("the reasons a sitting leaves for the candidate queue", () => {
  function finishedSession(groups: BlindStoredGroup[]) {
    return {
      id: 7,
      finishedAt: new Date("2026-11-20T00:00:00.000Z"),
      groups,
      answers: [{ group: 0, pick: "second" as const, seconds: 3, reason: "word" as const }],
    };
  }

  it("points at the expected answer's record, not at the case's position", () => {
    // The reason was given on case 3 of the run. Case 3's expected line
    // was cut from record 42; 3 is a position in a list, not a line.
    const cases = [0, 1, 2, 3].map((index) => ({
      expectedJson: index === 3
        ? { id: 42, role: "assistant", content: ORIGINAL }
        : { id: 100 + index, role: "assistant", content: `别的一句${index}` },
    }));
    const rows = feedbackRowsFromBlindSessions(
      [
        finishedSession([
          { caseId: 3, real: ORIGINAL, fake: "分身写的另一句", realFirst: false },
        ]),
      ],
      expectedMessageIdsFromCases(cases),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.messageId).toBe(42);
    // The reason is about the line the sitter did not pick — the
    // persona's line — so that is the unlike line the queue shows.
    expect(rows[0]!.snippet).toBe("分身写的另一句");
  });

  it("uses the record id stored with the pair when one is there", () => {
    const rows = feedbackRowsFromBlindSessions(
      [
        finishedSession([
          { caseId: 3, messageId: 77, real: ORIGINAL, fake: "分身写的另一句", realFirst: false },
        ]),
      ],
      new Map([[3, 42]]),
    );
    expect(rows[0]!.messageId).toBe(77);
  });

  it("does not leave a candidate that points at nothing", () => {
    // A sitting from before the record id was stored, and no stored
    // case to resolve the position against: there is no object to
    // point at, so there is no candidate.
    const rows = feedbackRowsFromBlindSessions([
      finishedSession([{ caseId: 3, real: ORIGINAL, fake: "分身写的另一句", realFirst: false }]),
    ]);
    expect(rows).toEqual([]);
  });
});
