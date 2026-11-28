import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { copy } from "@shared/copy";
import { checkPersonaStructure, completePersona } from "./fidelity-gate";
import {
  buildSystemPrompt,
  buildSystemPromptParts,
  resolvePromptLayout,
} from "./persona-utils";

function paragraphs(text: string): string[] {
  return text.split("\n\n").filter(Boolean);
}

const persona = completePersona();
const options = {
  locale: "zh" as const,
  sampledAct: "tease" as const,
  memorySection: "【记忆】海边",
  userContext: "【档案】阿树",
};

describe("PROMPT_LAYOUT", () => {
  const previous = process.env.PROMPT_LAYOUT;
  afterEach(() => {
    if (previous === undefined) delete process.env.PROMPT_LAYOUT;
    else process.env.PROMPT_LAYOUT = previous;
  });

  it("is classic when the env is unset", () => {
    delete process.env.PROMPT_LAYOUT;
    expect(resolvePromptLayout()).toBe("classic");
    const unset = buildSystemPrompt(persona, { locale: "zh" });
    const classic = buildSystemPrompt(persona, { locale: "zh", layout: "classic" });
    expect(unset).toBe(classic);
  });

  it("puts every stable block before every volatile block in cache layout", () => {
    const cache = buildSystemPromptParts(persona, { ...options, layout: "cache" });
    expect(cache.stable).toBeTruthy();
    expect(cache.volatile).toBeTruthy();
    expect(cache.prompt.startsWith(cache.stable)).toBe(true);
    expect(cache.prompt.endsWith(cache.volatile)).toBe(true);
    expect(cache.prompt.indexOf(cache.volatile)).toBeGreaterThanOrEqual(cache.stable.length);
  });

  it("keeps each group's internal order, except the act moved to the front", () => {
    /**
     * Production passes the seed-turn note.
     *
     * `generate.ts` sets `seedTurnsNote: seeds.note` whenever it splices
     * recorded exchanges into the message list, and that paragraph is
     * the first volatile block in the classic layout. The old test did
     * not pass it, so the volatile group it compared never contained
     * that block — and the claim it was named after ("the relative
     * order inside each group is the same as classic") was never
     * exercised. A probe with the production shape shows the cache
     * layout really does reorder the volatile group (B2.9).
     */
    const seedTurnsNote = copy("zh", "prompt.seedTurnsNote");
    const production = { ...options, seedTurnsNote };
    const classic = buildSystemPromptParts(persona, { ...production, layout: "classic" });
    const cache = buildSystemPromptParts(persona, { ...production, layout: "cache" });

    // The stable group keeps classic's paragraphs, in classic's order.
    expect(paragraphs(cache.stable)).toEqual(paragraphs(classic.stable));

    const act = copy("zh", "prompt.actHeading");
    const classicVolatile = paragraphs(classic.volatile);
    const cacheVolatile = paragraphs(cache.volatile);
    expect([...cacheVolatile].sort()).toEqual([...classicVolatile].sort());

    /**
     * Deviation from the acceptance sentence "两类内部的相对顺序与
     * classic 相同" (the relative order inside both groups is the same
     * as classic).
     *
     * It is not literally true for the volatile group, and the manual's
     * own 做法 3 says why: the act instruction must be the first
     * volatile block, so the cache layout moves it there. The probe
     * (passing the seed note, as production does) shows the difference:
     * classic starts the volatile group with the seed-turn note and has
     * the act instruction later; cache starts with the act instruction
     * and the seed note is second. What the layout really guarantees —
     * asserted below — is: the same set of paragraphs; the act first;
     * every *other* volatile paragraph in classic's relative order. The
     * acceptance wording is recorded here rather than asserted.
     */
    expect(cacheVolatile[0]).toContain(act);
    expect(classicVolatile[0]).toBe(seedTurnsNote);
    expect(cacheVolatile[1]).toBe(seedTurnsNote);
    expect(classicVolatile.filter((block) => block.includes(act))).toHaveLength(1);
    const withoutAct = (blocks: string[]) => blocks.filter((block) => !block.includes(act));
    expect(withoutAct(cacheVolatile)).toEqual(withoutAct(classicVolatile));
  });

  it("contains the same paragraphs in both layouts", () => {
    const classic = buildSystemPrompt(persona, { ...options, layout: "classic" });
    const cache = buildSystemPrompt(persona, { ...options, layout: "cache" });
    expect([...paragraphs(cache)].sort()).toEqual([...paragraphs(classic)].sort());
  });

  it("keeps the stable prefix identical across two adjacent turns", () => {
    const first = buildSystemPromptParts(persona, {
      ...options,
      memorySection: "【记忆】海边",
      sampledAct: "tease",
      layout: "cache",
    });
    const second = buildSystemPromptParts(persona, {
      ...options,
      memorySection: "【记忆】书店",
      sampledAct: "comfort",
      layout: "cache",
    });
    expect(first.stable).toBe(second.stable);
    expect(first.volatile).not.toBe(second.volatile);
    expect(first.cacheBreak).toBe(first.stable.length);
  });
});

describe("the fidelity gate under both layouts", () => {
  it("passes all seven checks in classic and in cache", () => {
    const classic = checkPersonaStructure(completePersona(), "classic");
    expect(classic.ok).toBe(true);
    expect(classic.checks).toHaveLength(7);
    const cache = checkPersonaStructure(completePersona(), "cache");
    expect(cache.ok).toBe(true);
    expect(cache.checks).toHaveLength(7);
  });

  it("hands the resolved layout to the command-line gate", () => {
    const source = readFileSync(join(__dirname, "../../scripts/fidelity-gate.ts"), "utf8");
    expect(source).toContain("checkPersonaStructure(completePersona(), layout)");
  });
});
