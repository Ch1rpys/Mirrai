import { describe, expect, it } from "vitest";
import { buildXiaomanRecords } from "../server/test-fixtures/xiaoman";
import { ADDRESS_WORDS_EN, ADDRESS_WORDS_ZH, type FingerprintRow } from "./style-fingerprint";
import { mineAddressForms, pickThemToMeAddress, type AddressEntry } from "./address-history";
import { buildSystemPrompt } from "../server/_core/persona-utils";

function fixtureRows(): FingerprintRow[] {
  return buildXiaomanRecords().map((row) => ({
    role: row.role,
    content: row.content,
    timestamp: row.timestamp,
    kind: row.kind,
    emotion: row.truth.state,
  }));
}

const KNOWN = ["树树", "陈树", "小满", ...ADDRESS_WORDS_ZH, ...ADDRESS_WORDS_EN];

describe("mineAddressForms", () => {
  it("finds 树树 and 陈树 as them_to_me on the fixture, and ignores a middle word", () => {
    const extra: FingerprintRow[] = Array.from({ length: 20 }, () => ({
      role: "assistant",
      content: "我下午去了图书馆",
      timestamp: new Date("2023-01-01T12:00:00.000Z"),
      kind: "text",
      emotion: "warm",
    }));
    const mined = mineAddressForms([...fixtureRows(), ...extra], [...KNOWN, "图书馆"]);
    const them = mined.filter((entry) => entry.direction === "them_to_me");
    const shu = them.find((entry) => entry.form === "树树");
    const chen = them.find((entry) => entry.form === "陈树");
    expect(shu).toBeTruthy();
    expect(chen).toBeTruthy();
    expect(Object.keys(chen?.byState ?? {})).toEqual(["distant"]);
    expect(them.some((entry) => entry.form === "图书馆")).toBe(false);
  });

  it("finds 树树 from the lines themselves, and does not take a short reply as a name", () => {
    const known = ["宝贝", "阿树", "小满", ...ADDRESS_WORDS_ZH, ...ADDRESS_WORDS_EN];
    const mined = mineAddressForms(fixtureRows(), known, { timeZone: "Asia/Shanghai" });
    const them = mined.filter((entry) => entry.direction === "them_to_me");
    const forms = them.map((entry) => entry.form);
    expect(forms).toContain("树树");
    expect(forms).toContain("陈树");
    expect(forms).not.toContain("晚安");
    expect(forms).not.toContain("嗯");
    expect(forms).not.toContain("随便");
    expect(forms).not.toContain("哦");
    expect(forms).not.toContain("行");
    expect(pickThemToMeAddress(them)).toBe("树树");
    expect(them.find((entry) => entry.form === "陈树")?.byState).toEqual({ distant: expect.any(Number) });
  });

  it("files a Shanghai morning in that morning's quarter", () => {
    const rows = Array.from({ length: 10 }, () => ({
      role: "assistant" as const,
      content: "陈树，早",
      timestamp: new Date("2022-04-01T07:40:00+08:00"),
      kind: "text" as const,
      emotion: "warm" as const,
    }));
    const mined = mineAddressForms(rows, ["陈树"], { timeZone: "Asia/Shanghai" });
    expect(mined[0]?.byQuarter).toEqual({ "2022Q2": 10 });
    expect(mined[0]?.byMonth).toEqual({ "2022-04": 10 });
  });
});

describe("the nickname line", () => {
  const speaking = {
    personality: "温柔",
    speakingStyle: "短句",
    catchphrases: ["嗯嗯"],
    nickname: "宝贝",
  };

  it("uses the latest quarter's most common them_to_me form", () => {
    const prompt = buildSystemPrompt(
      {
        id: 1,
        name: "小满",
        personaData: speaking,
        styleProfile: {
          version: 1,
          measuredAt: "2026-01-01T00:00:00.000Z",
          recordsVersion: "1:1",
          addressHistory: [
            {
              form: "树树",
              direction: "them_to_me",
              total: 100,
              byQuarter: { "2022Q1": 80, "2023Q4": 5 },
              byState: { warm: 80 },
            },
            {
              form: "陈树",
              direction: "them_to_me",
              total: 40,
              byQuarter: { "2023Q4": 40 },
              byState: { distant: 40 },
            },
          ],
        },
      },
      { locale: "zh" },
    );
    expect(prompt).toContain("称呼对方：陈树");
    expect(prompt).not.toContain("称呼对方：树树");
  });

  it("uses the first period's most common them_to_me form when that period is selected", () => {
    const prompt = buildSystemPrompt(
      {
        id: 1,
        name: "小满",
        personaData: {
          ...speaking,
          periods: [
            { id: "p1", from: "2022-01-01", to: "2022-12-31" },
            { id: "p2", from: "2023-01-01", to: "2023-12-31" },
          ],
        },
        styleProfile: {
          version: 1,
          measuredAt: "2026-01-01T00:00:00.000Z",
          recordsVersion: "1:1",
          addressHistory: [
            {
              form: "树树",
              direction: "them_to_me",
              total: 80,
              byQuarter: { "2022Q2": 80, "2023Q4": 5 },
              byState: { warm: 80 },
            },
            {
              form: "陈树",
              direction: "them_to_me",
              total: 40,
              byQuarter: { "2023Q4": 40 },
              byState: { distant: 40 },
            },
          ],
        },
      },
      { locale: "zh", periodId: "p1" },
    );
    expect(prompt).toContain("称呼对方：树树");
    expect(prompt).not.toContain("称呼对方：陈树");
  });

  it("keeps the stored nickname when there is no address history", () => {
    const prompt = buildSystemPrompt(
      { id: 1, name: "小满", personaData: speaking },
      { locale: "zh" },
    );
    expect(prompt).toContain("称呼对方：宝贝");
  });
});

describe("pickThemToMeAddress", () => {
  it("returns null when the list is empty", () => {
    expect(pickThemToMeAddress([])).toBeNull();
  });

  it("counts a period by the months inside it, not the whole quarter", () => {
    const history: AddressEntry[] = [
      {
        form: "一月",
        direction: "them_to_me" as const,
        total: 10,
        byQuarter: { "2022Q1": 10 },
        byMonth: { "2022-01": 10 },
        byState: {},
      },
      {
        form: "三月中",
        direction: "them_to_me" as const,
        total: 3,
        byQuarter: { "2022Q1": 3 },
        byMonth: { "2022-03": 3 },
        byState: {},
      },
    ];
    expect(
      pickThemToMeAddress(history, { period: { from: "2022-03-15", to: "2022-03-20" } }),
    ).toBe("三月中");
  });
});
