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

  it("replaces a street address and leaves an ordinary sentence about a city alone", () => {
    // The keepsake book's share copy promises to take out the addresses
    // (C6.3) as well as names and numbers. The rule is conservative: a
    // city and a street with a number is an address, a sentence that
    // merely mentions a city is not.
    const letter = contentOf("寄到上海市徐汇区淮海中路1234号", { addresses: true });
    expect(letter).toContain("[address]");
    expect(letter).not.toContain("淮海中路1234号");
    expect(contentOf("浙江省杭州市西湖区文三路90号", { addresses: true }))
      .toBe("[address]");
    const waiting = contentOf("我在文三路90号等你", { addresses: true });
    expect(waiting).toContain("[address]");
    expect(waiting).not.toContain("文三路90号");
    expect(contentOf("上海市很热闹", { addresses: true })).toBe("上海市很热闹");
    expect(contentOf("我在杭州工作", { addresses: true })).toBe("我在杭州工作");
    expect(contentOf("那条路很长", { addresses: true })).toBe("那条路很长");
    // Off by default.
    expect(contentOf("上海市徐汇区淮海中路1234号", { phones: true }))
      .toBe("上海市徐汇区淮海中路1234号");
  });

  it("replaces a Chinese address written with spaces between the parts", () => {
    // People paste addresses with spaces between the province, the
    // district and the house number. The compact form was covered and
    // the spaced one was not: the city rule had no room for a space, so
    // the shares carried the address verbatim.
    expect(contentOf("上海市 浦东新区 世纪大道 100 号", { addresses: true }))
      .toBe("[address]");
    expect(contentOf("上海市浦东新区世纪大道100号", { addresses: true }))
      .toBe("[address]");
    expect(contentOf("徐汇区 淮海中路 100 号", { addresses: true }))
      .toBe("[address]");
    expect(contentOf("寄到 上海市 徐汇区 淮海中路 1234 号", { addresses: true }))
      .toBe("寄到 [address]");
  });

  it("replaces an English address and leaves a street name without a number alone", () => {
    // The share copy promised addresses, but only the Chinese rules
    // ran — so "123 Main Street" went out as it was.
    expect(contentOf("123 Main Street", { addresses: true })).toBe("[address]");
    expect(contentOf("寄到 221B Baker Street, Apt 4", { addresses: true }))
      .toBe("寄到 [address]");
    expect(contentOf("500 Fifth Avenue", { addresses: true })).toBe("[address]");
    expect(contentOf("10 Downing St", { addresses: true })).toBe("[address]");
    expect(contentOf("I live near Baker Street", { addresses: true }))
      .toBe("I live near Baker Street");
    expect(contentOf("The 2024 season was great.", { addresses: true }))
      .toBe("The 2024 season was great.");
    expect(contentOf("Room 123 is ready", { addresses: true }))
      .toBe("Room 123 is ready");
    expect(contentOf("I bought 2 Way Tickets", { addresses: true }))
      .toBe("I bought 2 Way Tickets");
  });

  it("leaves an ordinary sentence about a city square alone unless there is a number", () => {
    // The old rule treated "市…广场" as an address on its own, so
    // ordinary sentences were replaced: "我们去市中心广场吧" came out
    // as "[address]吧". A place name only counts with a house/lane/unit
    // number.
    expect(contentOf("我们去市中心广场吧", { addresses: true }))
      .toBe("我们去市中心广场吧");
    expect(contentOf("晚上去跳广场舞", { addresses: true }))
      .toBe("晚上去跳广场舞");
    expect(contentOf("上海市徐汇区", { addresses: true }))
      .toBe("上海市徐汇区");
    expect(contentOf("今年是 2024 年", { addresses: true })).toBe("今年是 2024 年");
    expect(contentOf("有 100 个人来了", { addresses: true }))
      .toBe("有 100 个人来了");
  });

  it("replaces the room and building name that follow the house number (C6.3)", () => {
    // Replacing up to the first house number left the rest of the address
    // in the share copy: "淮海中路1234号501室" came out as
    // "[address]501室" and "建国路88号SOHO现代城" kept the building.
    expect(contentOf("上海市徐汇区淮海中路1234号501室", { addresses: true }))
      .toBe("[address]");
    expect(contentOf("我家在 世纪大道 100 号 501 室", { addresses: true }))
      .toBe("我家在 [address]");
    expect(contentOf("北京市朝阳区建国路88号SOHO现代城", { addresses: true }))
      .toBe("[address]");
    expect(contentOf("上海市徐汇区淮海中路1234弄5号", { addresses: true }))
      .toBe("[address]");
    // A sentence after the address is not part of it.
    expect(contentOf("淮海中路1234号楼下等我", { addresses: true }))
      .toBe("[address]楼下等我");
  });

  it("replaces the lettered building and 号楼 tail after the house number (C6.3)", () => {
    // The tail only knew numbered rooms and a few named buildings, so a
    // lettered building or a 号楼 form went out with the share copy:
    // "…号SOHO现代城A座" printed "[address]A座", "…号B栋" printed
    // "[address]B栋", and "…号5号楼" printed "[address]楼" (it kept the
    // room/floor character of the unit). The segments may follow each
    // other, and the spaces people paste between them are part of it.
    expect(contentOf("上海市徐汇区淮海中路1234号SOHO现代城A座", { addresses: true }))
      .toBe("[address]");
    expect(contentOf("北京市朝阳区建国路88号B栋", { addresses: true }))
      .toBe("[address]");
    expect(contentOf("北京市朝阳区建国路88号5号楼", { addresses: true }))
      .toBe("[address]");
    expect(contentOf("北京市朝阳区建国路88号SOHO现代城A座501室", { addresses: true }))
      .toBe("[address]");
    expect(contentOf("上海市徐汇区淮海中路1234号2单元3层", { addresses: true }))
      .toBe("[address]");
    expect(contentOf("上海市徐汇区淮海中路 1234 号 B 栋 501 室", { addresses: true }))
      .toBe("[address]");
  });

  it("keeps an ordinary sentence after an address (C6.3)", () => {
    // "楼" is also a unit character, so an over-eager tail would eat the
    // start of the next sentence: "1234号楼下等我" must keep "楼下等我".
    // The separating space and comma stay outside the replacement.
    expect(contentOf("淮海中路1234号楼下等我", { addresses: true }))
      .toBe("[address]楼下等我");
    expect(contentOf("淮海中路1234号 楼下等我", { addresses: true }))
      .toBe("[address] 楼下等我");
    expect(contentOf("淮海中路1234号，楼下等我", { addresses: true }))
      .toBe("[address]，楼下等我");
    expect(contentOf("淮海中路1234号B栋楼下等我", { addresses: true }))
      .toBe("[address]楼下等我");
    expect(contentOf("淮海中路1234号SOHO现代城A座，我到了", { addresses: true }))
      .toBe("[address]，我到了");
  });

  it("leaves a compound without a house number alone (deviation 641)", () => {
    // The old rule treated "市…小区/花园/大厦" as an address on its own,
    // which also replaced "我们去市中心广场吧". The tightened rule needs a
    // house number, so a compound named without one is no longer
    // replaced; the trade-off is recorded as deviation 641 instead of
    // printing part of an address.
    expect(contentOf("上海市徐汇区阳光花园", { addresses: true }))
      .toBe("上海市徐汇区阳光花园");
  });

  it("records the named-compound over-consumption as deviation 642", () => {
    // Known limitation, recorded as deviation 642 instead of silencing
    // it: the named-building tail cannot tell a building name from an
    // ordinary clause that happens to end in 城/大厦/广场/花园/中心/府,
    // so the clause after the house number goes with the address. The
    // third re-acceptance called this out as "still swallowing the
    // sentence after the address"; tightening it would drop real named
    // buildings (万达广场, SOHO现代城) or require punctuation that people
    // do not type. The ordinary sentence cases that can be separated
    // are pinned above (楼下等我 in three forms), so this test documents
    // the residue rather than claiming it was fixed.
    expect(contentOf("淮海中路1234号附近有个广场", { addresses: true }))
      .toBe("[address]");
    expect(contentOf("淮海中路1234号市中心广场见", { addresses: true }))
      .toBe("[address]见");
    // A sentence whose end is not a building word is kept.
    expect(contentOf("淮海中路1234号我到了", { addresses: true }))
      .toBe("[address]我到了");
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

  it("redacts the text a record keeps in meta, not only content (C1.7)", () => {
    // A voice note's transcript is the actual words, and a media file's
    // name comes from the phone — both were stored verbatim while the
    // content was replaced. `recordText` and the search tokens read
    // `meta.transcript`, so the original survived the "cannot be found
    // again" promise in another column.
    const voice = {
      speaker: "小满",
      role: "assistant",
      content: "[voice:3]",
      meta: { durationSec: 3, transcript: "今天打 13800138000 聊了会儿" },
    };
    const image = {
      speaker: "小满",
      role: "assistant",
      content: "[image]",
      meta: {
        path: "相册/琪琪_13800138000.jpg",
        register: "public",
        mode: "voice",
        direction: "in",
      },
    };
    const { records, counts } = redactRecords([voice, image], { phones: true, names: ["琪琪"] });
    expect(records[0]!.meta).toEqual({
      durationSec: 3,
      transcript: "今天打 [phone] 聊了会儿",
    });
    // `register`/`mode`/`direction` are enums the writer reads, not text
    // from the file; the path and the label are text and are replaced.
    expect(records[1]!.meta).toEqual({
      path: "相册/[person-1]_[phone].jpg",
      register: "public",
      mode: "voice",
      direction: "in",
    });
    expect(counts.phones).toBe(2);
    expect(counts.names).toBe(1);
    expect(JSON.stringify(records)).not.toContain("13800138000");
    expect(JSON.stringify(records)).not.toContain("琪琪");
  });

  it("keeps a meta-only row's identity when nothing in it is redactable", () => {
    const untouched = {
      speaker: "小满",
      role: "assistant",
      content: "[voice:12]",
      meta: { path: "voice.ogg", durationSec: 12, transcript: "刚下课" },
    };
    const { records, counts } = redactRecords([untouched], { phones: true });
    expect(records[0]).toBe(untouched);
    expect(counts).toEqual({
      phones: 0,
      ids: 0,
      emails: 0,
      cards: 0,
      names: 0,
      addresses: 0,
    });
  });

  it("counts a meta replacement in the same report as the content (C1.7)", () => {
    const { counts } = redactRecords(
      [{ speaker: "小满", content: "[voice:3]", meta: { transcript: "打 13800138000" } }],
      { phones: true },
    );
    const report = redactionReportOf({ phones: true }, counts);
    expect(report.replaced.phones).toBe(1);
    expect(JSON.stringify(report)).not.toContain("13800138000");
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
      addresses: false,
      replaced: { phones: 1, ids: 0, emails: 0, cards: 0, names: 1, addresses: 0 },
    });
    expect(JSON.stringify(report)).not.toContain("13800138000");
    expect(JSON.stringify(report)).not.toContain("琪琪");
  });
});
