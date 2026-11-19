import { describe, expect, it } from "vitest";
import { buildXiaomanRecords } from "../server/test-fixtures/xiaoman";
import { measureFingerprint, type FingerprintRow, type StyleFingerprint } from "./style-fingerprint";
import { draftImperfection } from "./imperfection-draft";

function fixtureRows(): FingerprintRow[] {
  return buildXiaomanRecords().map((row, index) => ({
    id: index + 1,
    role: row.role,
    content: row.content,
    timestamp: row.timestamp,
    kind: row.kind,
    emotion: row.truth.state,
  }));
}

function fixtureFingerprint(): StyleFingerprint {
  const fingerprint = measureFingerprint(fixtureRows(), { addressForms: ["陈树", "树树"] });
  if (!fingerprint) throw new Error("fixture fingerprint missing");
  return fingerprint;
}

/**
 * Turns are kept together by alternating the two speakers; the assistant
 * lines in one turn share the state the scene was labelled with.
 */
function burstRows(): FingerprintRow[] {
  const rows: FingerprintRow[] = [];
  const start = Date.UTC(2024, 0, 1, 12, 0, 0);
  let id = 1;
  const add = (role: string, content: string, at: number, emotion: string) => {
    rows.push({
      id: id++,
      role,
      content,
      timestamp: new Date(at),
      kind: "text",
      emotion,
    });
  };
  for (let scene = 0; scene < 12; scene++) {
    const base = start + scene * 7 * 3_600_000;
    add("user", "在吗", base, "warm");
    for (let line = 0; line < 3; line++) add("assistant", "在的", base + 1_000 + line * 1_000, "warm");
  }
  for (let scene = 0; scene < 12; scene++) {
    const base = start + 4 * 3_600_000 + scene * 7 * 3_600_000;
    add("user", "在吗", base, "distant");
    add("assistant", "嗯。", base + 1_000, "distant");
  }
  return rows;
}

describe("draftImperfection", () => {
  it("drafts a short distant state that ends on a period, and leaves warm alone", () => {
    const rows = fixtureRows();
    const drafts = draftImperfection({ fingerprint: fixtureFingerprint() }, { locale: "zh", rows });
    const distant = (drafts.distant ?? []).map((row) => row.text);
    expect(distant.some((text) => text.includes("话很短"))).toBe(true);
    expect(distant.some((text) => text.includes("句末带句号"))).toBe(true);
    expect(drafts.warm).toBeUndefined();
    expect((drafts.distant ?? []).every((row) => row.evidence.length >= 2)).toBe(true);
  });

  it("reads the burst size from the turns, not from the follow-up profile", () => {
    const drafts = draftImperfection(
      { fingerprint: fixtureFingerprint() },
      { locale: "zh", rows: burstRows() },
    );
    const distant = (drafts.distant ?? []).map((row) => row.text);
    expect(distant).toContain("一次只发一条");
  });

  it("reads the reply delay from the measured buckets", () => {
    const drafts = draftImperfection(
      {
        fingerprint: fixtureFingerprint(),
        replyDelay: {
          samples: 40,
          resolution: "second",
          buckets: {
            "evening|distant|false": { n: 20, mu: Math.log(600), sigma: 0.5 },
            "evening|warm|false": { n: 20, mu: Math.log(30), sigma: 0.5 },
          },
        },
      },
      { locale: "zh", rows: fixtureRows() },
    );
    const distant = (drafts.distant ?? []).map((row) => row.text);
    expect(distant).toContain("回得慢，常常隔 10 分钟");
  });
});
