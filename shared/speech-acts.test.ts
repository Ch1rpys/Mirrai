import { describe, expect, it } from "vitest";
import {
  isFeedbackReason,
  isSpeechAct,
  isUserAsking,
  labelSpeechActByRule,
  renderActInstruction,
} from "./speech-acts";

describe("labelling a line from the words", () => {
  it("calls a lone 嗯 an acknowledgement", () => {
    expect(labelSpeechActByRule("嗯")).toBe("acknowledge");
    expect(labelSpeechActByRule("好的。")).toBe("acknowledge");
  });

  it("calls an empty line silence", () => {
    expect(labelSpeechActByRule("")).toBe("silence");
    expect(labelSpeechActByRule("   ")).toBe("silence");
  });

  it("calls a time and a place logistics", () => {
    expect(labelSpeechActByRule("明天三点见面")).toBe("logistics");
  });

  it("calls an apology repair", () => {
    expect(labelSpeechActByRule("对不起，是我不好")).toBe("repair");
  });

  it("leaves a line it cannot decide", () => {
    expect(labelSpeechActByRule("风有点大")).toBeNull();
  });

  it("answers a question when the previous line asked one", () => {
    expect(labelSpeechActByRule("在公司", "你在哪？")).toBe("answer");
  });
});

describe("whether the other person asked", () => {
  it("reads a question mark", () => {
    expect(isUserAsking("在吗？")).toBe(true);
    expect(isUserAsking("在的")).toBe(false);
  });
});

describe("the closed sets", () => {
  it("knows its own labels", () => {
    expect(isSpeechAct("tease")).toBe(true);
    expect(isSpeechAct("yell")).toBe(false);
    expect(isFeedbackReason("word")).toBe(true);
    expect(isFeedbackReason("vibe")).toBe(false);
  });

  it("writes one action into the instruction", () => {
    const text = renderActInstruction("acknowledge", "zh");
    expect(text).toContain("嗯、收到、在，不展开");
    expect(text).not.toContain("给办法");
  });
});
