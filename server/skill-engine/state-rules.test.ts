import { describe, expect, it } from "vitest";
import { measureFingerprint, type FingerprintRow } from "@shared/style-fingerprint";
import type { PersonaData } from "../_core/persona-schema";
import { mergeUserDecisions } from "./pipeline";
import { buildXiaomanRecords } from "../test-fixtures/xiaoman";
import { fingerprintRowsFrom, mineStateRules, stateRulesFromTranscript } from "./state-rules";

const fresh: PersonaData = {
  personality: "温柔",
  speakingStyle: "短句",
  catchphrases: ["嗯嗯"],
  nickname: "宝贝",
  memories: "",
  attachmentStyle: "",
  loveLanguage: "",
  conflictStyle: "",
  touchingMoments: "",
  summary: "",
  realismLevel: 70,
  relationshipPhase: "initial",
  microRules: [],
  imperfectionProfile: [],
};

function fixtureRows(): FingerprintRow[] {
  return buildXiaomanRecords().map((row) => ({
    role: row.role,
    content: row.content,
    timestamp: row.timestamp,
    kind: row.kind,
    emotion: row.truth.state,
    speaker: row.speaker,
  }));
}

function fixtureFingerprint(rows = fixtureRows()) {
  const fp = measureFingerprint(rows, { addressForms: ["陈树", "树树"] });
  if (!fp) throw new Error("fixture fingerprint missing");
  return fp;
}

describe("mineStateRules", () => {
  it("reads a period rule and a 陈树 rule off distant on the fixture", () => {
    const rows = fixtureRows();
    const rules = mineStateRules({
      fingerprint: fixtureFingerprint(rows),
      rows,
      locale: "zh",
    });
    const period = rules.find((rule) => rule.trigger[0] === "。");
    const address = rules.find((rule) => rule.trigger[0] === "陈树");
    expect(period?.meaning).toBe("疏离");
    expect(address?.meaning).toBe("疏离");
    expect(period?.verified).toBe(false);
    expect(period?.source).toBe("auto");
    expect(period?.evidence).toHaveLength(3);
    expect(address?.evidence).toHaveLength(3);
    expect(period?.evidence.every((item) => item.snippet.includes("。"))).toBe(true);
    expect(address?.evidence.every((item) => item.snippet.includes("陈树"))).toBe(true);
    expect(period?.evidence.every((item) => Boolean(item.at))).toBe(true);
    expect(period?.id).toMatch(/^auto-state-distant-/);
  });

  it("finds the distant address from the fixture without a hand-fed name list", () => {
    const rules = stateRulesFromTranscript(fixtureRows(), {
      locale: "zh",
      name: "小满",
      nickname: "宝贝",
    });
    const triggers = rules.map((rule) => rule.trigger[0]);
    expect(triggers).toContain("。");
    expect(triggers).toContain("陈树");
    expect(triggers).not.toContain("嗯");
    expect(triggers).not.toContain("晚安");
  });

  it("produces nothing when distant is cut to fifteen lines", () => {
    const records = buildXiaomanRecords();
    const distant = records.filter(
      (row) => row.role === "assistant" && row.kind === "text" && row.truth.state === "distant",
    );
    const others = records.filter(
      (row) => !(row.role === "assistant" && row.kind === "text" && row.truth.state === "distant"),
    );
    const truncated = fingerprintRowsFrom(
      [...others, ...distant.slice(0, 15)].map((row) => ({
        role: row.role,
        content: row.content,
        timestamp: row.timestamp,
        kind: row.kind,
        emotion: row.truth.state,
      })),
    );
    const rules = mineStateRules({
      fingerprint: measureFingerprint(truncated, { addressForms: ["陈树", "树树"] }),
      rows: truncated,
      locale: "zh",
    });
    expect(rules).toEqual([]);
  });

  it("does not add a second period candidate when the user already confirmed one", () => {
    const rows = fixtureRows();
    const mined = mineStateRules({
      fingerprint: fixtureFingerprint(rows),
      rows,
      locale: "zh",
    });
    const period = mined.find((rule) => rule.trigger[0] === "。");
    if (!period) throw new Error("expected a period candidate");
    const confirmed = { ...period, id: "user-period", verified: true, source: "manual" as const };
    const merged = mergeUserDecisions(
      fresh,
      { microRules: [confirmed] },
      mined,
      "zh",
    );
    const periods = (merged.microRules ?? []).filter((rule) => rule.trigger[0] === "。");
    expect(periods).toHaveLength(1);
    expect(periods[0]?.id).toBe("user-period");
  });
});
