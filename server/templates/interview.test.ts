import { describe, expect, it, vi } from "vitest";
import { copy } from "@shared/copy";
import type { InterviewAspect, InterviewTurn } from "@shared/interview";
import {
  INTERVIEW_ASPECTS,
  INTERVIEW_MAX_ROUNDS,
  answeredRounds,
  buildInterviewMessages,
  coveredAspects,
  firstUncoveredAspect,
  interviewEndReason,
  interviewTranscriptText,
  isInterviewDoneSignal,
  nextQuestion,
} from "./interview";
import type { LLMMessage } from "../llm/types";

function turn(aspect: InterviewAspect, answer = "讲过一点"): InterviewTurn {
  return { aspect, question: `关于${aspect}的问题`, answer };
}

/** Everything outside the material fence, so a leak can be seen. */
function outsideFence(text: string): string {
  return text.replace(/MATERIAL>>>:([0-9a-f]+)[\s\S]*?<<<END MATERIAL>>>:\1/g, "");
}

describe("the interview for a person with no records (C1.8)", () => {
  it("asks the ten aspects in the fixed order", async () => {
    const invoke = vi.fn(async () => "问一句");
    const first = await nextQuestion({ transcript: [], locale: "zh", invoke });
    expect(first.aspect).toBe(INTERVIEW_ASPECTS[0]);
    expect(first.round).toBe(1);

    // One answer is not enough: the same aspect is asked again.
    const second = await nextQuestion({
      transcript: [turn(INTERVIEW_ASPECTS[0])],
      locale: "zh",
      invoke,
    });
    expect(second.aspect).toBe(INTERVIEW_ASPECTS[0]);

    // Two answers cover it, and the next aspect is the second one.
    const third = await nextQuestion({
      transcript: [turn(INTERVIEW_ASPECTS[0]), turn(INTERVIEW_ASPECTS[0])],
      locale: "zh",
      invoke,
    });
    expect(third.aspect).toBe(INTERVIEW_ASPECTS[1]);
  });

  it("keeps asking the first uncovered aspect while everything around it is covered", async () => {
    const invoke = vi.fn(async () => "问一句");
    // Everything covered except people, which has one answer.
    const transcript = INTERVIEW_ASPECTS.flatMap((aspect) =>
      aspect === "people" ? [turn(aspect)] : [turn(aspect), turn(aspect)],
    );
    expect(coveredAspects(transcript).sort()).toEqual(
      INTERVIEW_ASPECTS.filter((aspect) => aspect !== "people").sort(),
    );
    expect(firstUncoveredAspect(transcript)).toBe("people");
    const result = await nextQuestion({ transcript, locale: "zh", invoke });
    expect(result.aspect).toBe("people");
  });

  it("tells the model which aspect the code chose", async () => {
    const invoke = vi.fn(async () => "你们平时怎么称呼对方？");
    await nextQuestion({
      transcript: [turn("address"), turn("address")],
      locale: "zh",
      invoke,
    });
    const [messages] = invoke.mock.calls[0] as unknown as [LLMMessage[]];
    expect(messages[0]?.content).toContain(
      copy("zh", "interview.aspect.catchphrase"),
    );
    expect(messages[0]?.content).not.toContain(
      copy("zh", "interview.aspect.address"),
    );
  });

  it("stops after twenty rounds: there is no twenty-first question", async () => {
    const invoke = vi.fn(async () => "问一句");
    const transcript = Array.from({ length: INTERVIEW_MAX_ROUNDS }, () =>
      turn("address"),
    );
    const ended = await nextQuestion({ transcript, locale: "zh", invoke });
    expect(ended.done).toBe(true);
    expect(ended.aspect).toBeNull();
    expect(ended.reason).toBe("max-rounds");
    expect(ended.round).toBe(INTERVIEW_MAX_ROUNDS + 1);
    expect(invoke).not.toHaveBeenCalled();

    // The twentieth answer is still asked a twentieth question.
    const before = await nextQuestion({
      transcript: transcript.slice(0, INTERVIEW_MAX_ROUNDS - 1),
      locale: "zh",
      invoke,
    });
    expect(before.done).toBe(false);
    expect(before.round).toBe(INTERVIEW_MAX_ROUNDS);
    // Everything asked so far was about the first aspect, so it is
    // covered and the next one is asked.
    expect(before.aspect).toBe("catchphrase");
  });

  it("ends the moment the person says 就这些", async () => {
    const invoke = vi.fn(async () => "问一句");
    for (const answer of ["就这些", "就这些。", " 就这些啦", "that's all"]) {
      const result = await nextQuestion({
        transcript: [turn("address", answer)],
        locale: "zh",
        invoke,
      });
      expect(result.done, answer).toBe(true);
      expect(result.reason).toBe("user-said-done");
      expect(result.aspect).toBeNull();
    }
    expect(isInterviewDoneSignal("就这些")).toBe(true);
    expect(isInterviewDoneSignal("他不太说话")).toBe(false);
  });

  it("ends when every aspect has been talked about twice", async () => {
    const invoke = vi.fn(async () => "问一句");
    const transcript = INTERVIEW_ASPECTS.flatMap((aspect) => [
      turn(aspect),
      turn(aspect),
    ]);
    const result = await nextQuestion({ transcript, locale: "zh", invoke });
    expect(result.done).toBe(true);
    expect(result.reason).toBe("all-covered");
  });

  it("falls back to its own question when the model cannot ask one", async () => {
    const failing = vi.fn(async () => {
      throw new Error("no provider");
    });
    const empty = vi.fn(async () => "");
    for (const invoke of [failing, empty]) {
      const result = await nextQuestion({ transcript: [], locale: "zh", invoke });
      expect(result.done).toBe(false);
      expect(result.question).toBe(copy("zh", "interview.question.address"));
    }
    // Without a model at all the interview still asks.
    const withoutModel = await nextQuestion({ transcript: [], locale: "zh" });
    expect(withoutModel.question).toBe(copy("zh", "interview.question.address"));
  });

  it("fences the transcript as material and keeps the instruction outside it", async () => {
    const invoke = vi.fn(async () => "接着问一句");
    await nextQuestion({
      transcript: [turn("address", "他叫我小满，我叫他阿树")],
      locale: "zh",
      invoke,
    });
    const [request] = invoke.mock.calls[0] as unknown as [LLMMessage[]];
    const user = String(request[1]?.content ?? "");
    expect(user).toContain("他叫我小满，我叫他阿树");
    expect(outsideFence(user)).not.toContain("他叫我小满，我叫他阿树");
    expect(outsideFence(user)).not.toContain("关于address的问题");
  });

  it("writes the transcript as ask-and-answer lines for the stored account", () => {
    const text = interviewTranscriptText(
      [turn("address", "他叫我小满"), turn("happy", "高兴的时候话很多")],
      "zh",
    );
    expect(text).toContain(copy("zh", "interview.transcriptAnswer", { text: "他叫我小满" }));
    expect(text).toContain(
      copy("zh", "interview.transcriptAnswer", { text: "高兴的时候话很多" }),
    );
    expect(text.split("\n\n")).toHaveLength(2);
    expect(answeredRounds([turn("address", " "), turn("happy", "说了一句")])).toBe(1);
    expect(interviewEndReason([])).toBeNull();
  });

  it("builds the message with the aspect named in the instruction", () => {
    const messages = buildInterviewMessages({
      transcript: [],
      aspect: "neverSay",
      locale: "en",
    });
    expect(messages[0]?.role).toBe("system");
    expect(String(messages[0]?.content)).toContain("something they would never say");
    expect(String(messages[1]?.content)).toContain("Nothing has been talked about yet.");
  });
});
