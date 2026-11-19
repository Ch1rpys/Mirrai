import { describe, expect, it } from "vitest";
import {
  EVIDENCE_ALWAYS_INFERRED,
  EVIDENCE_CARD_LIMIT,
  EVIDENCE_FIELD_DIMENSIONS,
  cardsForField,
  collectEvidence,
  fieldIsInferred,
} from "./evidence-map";

describe("which fields point at which cards", () => {
  it("maps each portrait field to the dimensions in the handbook", () => {
    expect(EVIDENCE_FIELD_DIMENSIONS.speakingStyle).toEqual(["expression", "habit"]);
    expect(EVIDENCE_FIELD_DIMENSIONS.catchphrases).toEqual(["expression", "habit"]);
    expect(EVIDENCE_FIELD_DIMENSIONS.personality).toEqual(["trigger", "care", "habit"]);
    expect(EVIDENCE_FIELD_DIMENSIONS.conflictStyle).toEqual(["conflict"]);
    expect(EVIDENCE_FIELD_DIMENSIONS.touchingMoments).toEqual(["memory"]);
    expect(EVIDENCE_FIELD_DIMENSIONS.memories).toEqual(["memory"]);
    expect(EVIDENCE_FIELD_DIMENSIONS.attachmentStyle).toEqual([]);
    expect(EVIDENCE_FIELD_DIMENSIONS.loveLanguage).toEqual([]);
    expect(EVIDENCE_ALWAYS_INFERRED).toEqual(["attachmentStyle", "loveLanguage"]);
  });

  it("marks attachment and love language as inferred even when other cards exist", () => {
    const byDimension = collectEvidence(
      [{ dimension: "habit", claim: "短句", payload: { quotes: [1] }, createdAt: new Date("2023-07-12") }],
      [{ id: 1, content: "在的呀", timestamp: new Date("2023-07-12"), speaker: "小满", role: "assistant" }],
    );
    expect(fieldIsInferred("attachmentStyle", byDimension)).toBe(true);
    expect(fieldIsInferred("loveLanguage", byDimension)).toBe(true);
    expect(fieldIsInferred("speakingStyle", byDimension)).toBe(false);
  });
});

describe("collecting quotes", () => {
  it("drops a quote whose record is missing", () => {
    const collected = collectEvidence(
      [{
        dimension: "habit",
        claim: "短句",
        payload: { quotes: [1, 2] },
        createdAt: new Date("2023-07-12T08:16:09.000Z"),
      }],
      [{
        id: 2,
        content: "在的呀",
        timestamp: new Date("2023-07-12T08:16:09.000Z"),
        speaker: "小满",
        role: "assistant",
      }],
      { timeZone: "UTC" },
    );
    expect(collected.habit[0]?.quotes).toEqual([
      {
        recordId: 2,
        at: "2023-07-12T08:16:09.000Z",
        day: "2023-07-12",
        speaker: "小满",
        text: "在的呀",
      },
    ]);
  });

  it("reads the quoted day in the reader's timezone", () => {
    const cards = [{
      dimension: "habit" as const,
      claim: "短句",
      payload: { quotes: [1] },
      createdAt: new Date("2023-07-12T08:16:09.000Z"),
    }];
    const records = [{
      id: 1,
      content: "凌晨还在",
      timestamp: new Date("2023-07-11T17:00:00.000Z"),
      speaker: "小满",
      role: "assistant",
    }];
    expect(
      collectEvidence(cards, records, { timeZone: "Asia/Shanghai" }).habit[0]?.quotes[0]?.day,
    ).toBe("2023-07-12");
    expect(
      collectEvidence(cards, records, { timeZone: "UTC" }).habit[0]?.quotes[0]?.day,
    ).toBe("2023-07-11");
  });

  it("keeps the newest thirty cards in a dimension", () => {
    const cards = Array.from({ length: 32 }, (_, i) => ({
      dimension: "conflict" as const,
      claim: `c${i}`,
      payload: { quotes: [i + 1] },
      createdAt: new Date(Date.UTC(2023, 0, 1 + i)),
    }));
    const records = cards.map((card, i) => ({
      id: i + 1,
      content: `line ${i + 1}`,
      timestamp: card.createdAt,
      speaker: "小满",
      role: "assistant" as const,
    }));
    const collected = collectEvidence(cards, records);
    expect(collected.conflict).toHaveLength(EVIDENCE_CARD_LIMIT);
    expect(collected.conflict[0]?.claim).toBe("c31");
    expect(cardsForField("conflictStyle", collected)[0]?.quotes[0]?.text).toBe("line 32");
  });
});
