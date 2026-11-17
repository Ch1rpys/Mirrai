import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const src = readFileSync(join(__dirname, "../../scripts/eval-run.ts"), "utf8");

describe("pnpm eval --compare", () => {
  it("compares action sampling on and off", () => {
    expect(src).toContain('variant: "withoutAct"');
    expect(src).toContain("action sampling on vs off");
  });

  it("prints why a reranked line won", () => {
    expect(src).toContain("why it won");
  });

  it("includes style in the comparison", () => {
    expect(src).toContain('row("style"');
    expect(src).toContain("[eval] style");
    expect(src).toContain("tolerance-style");
  });
});
