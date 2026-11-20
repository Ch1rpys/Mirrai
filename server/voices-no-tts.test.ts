import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The recordings page has no synthesised voice (C7.3).
 *
 * For somebody who has died, the page is the one place their voice is
 * still theirs. A read-aloud button here would put a generated voice
 * next to the real ones and call them the same thing — so the page is
 * checked for every route and helper that synthesises speech.
 */
const SOURCE = readFileSync(
  path.resolve(__dirname, "../client/src/pages/Voices.tsx"),
  "utf8",
);

describe("the recordings page", () => {
  it("does not call a text-to-speech route", () => {
    expect(SOURCE).not.toMatch(/trpc\.(chat|media)\.tts/);
    expect(SOURCE).not.toMatch(/chat\.tts|media\.tts/);
    expect(SOURCE).not.toMatch(/\b(generateTTS|textToSpeech|synthesize|synthesise)\s*\(/);
  });

  it("plays the real files", () => {
    expect(SOURCE).toMatch(/<audio/);
    expect(SOURCE).toMatch(/row\.url/);
  });
});
