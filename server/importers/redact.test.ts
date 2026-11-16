import { describe, expect, it } from "vitest";
import { redactRecords, redactionReportOf } from "./redact";

function row(content: string, extra: { speaker?: string; role?: string } = {}) {
  return {
    speaker: extra.speaker ?? "同事",
    role: extra.role ?? "other",
    content,
  };
}

function contentOf(text: string, options: Parameters<typeof redactRecords>[1]): string {
  return redactRecords([row(text)], options).records[0].content;
}

describe("redactRecords", () => {
  it("replaces a mainland mobile number and leaves an 11-digit number that is not one", () => {
    const { records, counts } = redactRecords(
      [row("打 13800138000 和 12345678901")],
      { phones: true },
    );
    expect(records[0].content).toBe("打 [phone] 和 12345678901");
    expect(counts.phones).toBe(1);
  });

  it("replaces an international number", () => {
    expect(contentOf("call +8613800138000", { phones: true })).toBe("call [phone]");
  });

  it("replaces an 18-digit id, including a trailing X", () => {
    expect(contentOf("证 110101199001011234 和 11010119900307851X", { ids: true }))
      .toBe("证 [id] 和 [id]");
    expect(contentOf("短 11010119900101123", { ids: true })).toBe("短 11010119900101123");
  });

  it("replaces an email", () => {
    expect(contentOf("写到 alice@example.com", { emails: true })).toBe("写到 [email]");
    expect(contentOf("不是邮箱 not@valid", { emails: true })).toBe("不是邮箱 not@valid");
  });

  it("replaces a Luhn-valid card and leaves a long number that fails Luhn", () => {
    expect(contentOf("卡 4111111111111111", { cards: true })).toBe("卡 [card]");
    expect(contentOf("卡 1234567890123", { cards: true })).toBe("卡 1234567890123");
  });

  it("maps two names onto stable person tokens", () => {
    const { records, counts } = redactRecords(
      [
        row("我妈说琪琪来了"),
        row("琪琪没来", { speaker: "琪琪", role: "other" }),
      ],
      { names: ["琪琪", "我妈"] },
    );
    expect(records[0].content).toBe("[person-2]说[person-1]来了");
    expect(records[1].content).toBe("[person-1]没来");
    expect(records[1].speaker).toBe("[person-1]");
    expect(counts.names).toBe(4);
  });

  it("does not replace the persona's name", () => {
    const { records } = redactRecords(
      [
        row("小满在吗", { speaker: "小满", role: "assistant" }),
        row("琪琪找小满"),
      ],
      { names: ["琪琪", "小满"], keepNames: ["小满"] },
    );
    expect(records[0].speaker).toBe("小满");
    expect(records[0].content).toBe("小满在吗");
    expect(records[1].content).toBe("[person-1]找小满");
  });

  it("does not replace a user or assistant speaker even when listed", () => {
    const { records } = redactRecords(
      [row("hi", { speaker: "阿树", role: "user" })],
      { names: ["阿树"] },
    );
    expect(records[0].speaker).toBe("阿树");
  });

  it("records which flags ran and the replacement counts, not the originals", () => {
    const { records, counts } = redactRecords(
      [row("13800138000 琪琪")],
      { phones: true, names: ["琪琪"], keepNames: ["小满"] },
    );
    const report = redactionReportOf(
      { phones: true, names: ["琪琪"], keepNames: ["小满"] },
      counts,
    );
    expect(records[0].content).toBe("[phone] [person-1]");
    expect(report).toEqual({
      phones: true,
      ids: false,
      emails: false,
      cards: false,
      nameCount: 1,
      replaced: { phones: 1, ids: 0, emails: 0, cards: 0, names: 1 },
    });
    expect(JSON.stringify(report)).not.toContain("13800138000");
    expect(JSON.stringify(report)).not.toContain("琪琪");
  });
});
