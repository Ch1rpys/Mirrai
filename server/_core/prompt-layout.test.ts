import { afterEach, describe, expect, it } from "vitest";
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

  it("keeps the relative order inside each group the same as classic", () => {
    const classic = buildSystemPromptParts(persona, { ...options, layout: "classic" });
    const cache = buildSystemPromptParts(persona, { ...options, layout: "cache" });
    expect(paragraphs(cache.stable)).toEqual(paragraphs(classic.stable));
    const classicVolatile = paragraphs(classic.volatile);
    const cacheVolatile = paragraphs(cache.volatile);
    const act = copy("zh", "prompt.actHeading");
    expect(cacheVolatile[0]).toContain(act);
    expect(classicVolatile.filter((block) => block.includes(act))).toHaveLength(1);
    expect([...cacheVolatile].sort()).toEqual([...classicVolatile].sort());
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
});
