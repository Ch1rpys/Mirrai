import { describe, expect, it } from "vitest";
import {
  isFeedbackReason,
  isSpeechAct,
  isUserAct,
  isUserAsking,
  labelSpeechActByRule,
  labelUserActByRule,
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

  it("leaves a self-share unlabelled when only the precise rules are kept", () => {
    expect(labelSpeechActByRule("我今天去了图书馆", "今天天气不错")).toBe("share");
    expect(
      labelSpeechActByRule("我今天去了图书馆", "今天天气不错", { precisionOnly: true }),
    ).toBeNull();
    expect(labelSpeechActByRule("嗯", undefined, { precisionOnly: true })).toBe("acknowledge");
    expect(labelSpeechActByRule("对不起", undefined, { precisionOnly: true })).toBe("repair");
    expect(labelSpeechActByRule("", undefined, { precisionOnly: true })).toBe("silence");
  });
});

describe("labelling the other person's line from the words", () => {
  it("calls 在吗 an ask even without a question mark", () => {
    expect(labelUserActByRule("在吗")).toBe("ask");
  });

  it("calls a lone 嗯 an acknowledgement", () => {
    expect(labelUserActByRule("嗯")).toBe("acknowledge");
  });

  it("calls an apology repair", () => {
    expect(labelUserActByRule("对不起")).toBe("repair");
  });

  it("calls 想你 affection", () => {
    expect(labelUserActByRule("想你")).toBe("affection");
  });

  it("leaves an ordinary statement unlabelled", () => {
    expect(labelUserActByRule("我今天去了图书馆")).toBeNull();
  });
});

describe("whether the other person asked", () => {
  it("reads a question mark", () => {
    expect(isUserAsking("在吗？")).toBe(true);
    expect(isUserAsking("在的")).toBe(false);
  });
});

/**
 * Traditional Chinese, read as the same words.
 *
 * The rules are written in simplified characters. A person writing
 * traditional Chinese writes the same words in different ones — 「對不起」
 * is 「对不起」 — and a regex cannot know that, so the line was left
 * unlabelled and the prompt lost the act.
 */
describe("labelling a traditional Chinese line", () => {
  it("calls a traditional apology repair", () => {
    expect(labelSpeechActByRule("對不起，是我不好")).toBe("repair");
    expect(labelUserActByRule("對不起")).toBe("repair");
  });

  it("calls a traditional acknowledgement an acknowledgement", () => {
    expect(labelUserActByRule("好的")).toBe("acknowledge");
    expect(labelUserActByRule("收到")).toBe("acknowledge");
  });

  it("calls a traditional affection line affection", () => {
    expect(labelUserActByRule("想你")).toBe("affection");
  });

  it("reads a traditional question as an ask", () => {
    expect(labelUserActByRule("為什麼")).toBe("ask");
    expect(isUserAsking("為什麼？")).toBe(true);
  });

  it("still leaves an ordinary traditional line unlabelled", () => {
    expect(labelUserActByRule("今天去了圖書館")).toBeNull();
  });
});

describe("the closed sets", () => {
  it("knows its own labels", () => {
    expect(isSpeechAct("tease")).toBe(true);
    expect(isSpeechAct("yell")).toBe(false);
    expect(isUserAct("ask")).toBe(true);
    expect(isUserAct("yell")).toBe(false);
    expect(isFeedbackReason("word")).toBe(true);
    expect(isFeedbackReason("vibe")).toBe(false);
  });

  it("writes one action into the instruction", () => {
    const text = renderActInstruction("acknowledge", "zh");
    expect(text).toContain("嗯、收到、在，不展开");
    expect(text).not.toContain("给办法");
  });
});
