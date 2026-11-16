import { describe, expect, it } from "vitest";
import { assignRoles, guessRoles } from "./roles";
import type { ParsedRecord } from "@shared/records";

function line(speaker: string, extra: Partial<ParsedRecord> = {}): ParsedRecord {
  return {
    speaker,
    content: "hi",
    timestamp: null,
    kind: "text",
    lineNo: 1,
    ...extra,
  };
}

describe("guessRoles", () => {
  it("fills the other side when there are two speakers and one is known", () => {
    expect(guessRoles(["小满", "阿树"], { personaName: "小满" })).toEqual({
      me: ["阿树"],
      them: ["小满"],
    });
  });

  it("returns null when three speakers cannot be named", () => {
    expect(guessRoles(["小满", "阿树", "同事"], { personaName: "小满" })).toBeNull();
  });

  it("takes fromMe on the records before matching names", () => {
    const records: ParsedRecord[] = [
      line("小满", { fromMe: true }),
      line("阿树", { fromMe: false }),
    ];
    expect(guessRoles(["小满", "阿树"], { personaName: "小满" }, records)).toEqual({
      me: ["小满"],
      them: ["阿树"],
    });
  });
});

describe("assignRoles", () => {
  it("trusts fromMe over the name map", () => {
    const rows = assignRoles(
      [line("小满", { fromMe: true })],
      { me: ["阿树"], them: ["小满"] },
    );
    expect(rows[0].role).toBe("user");
  });
});
