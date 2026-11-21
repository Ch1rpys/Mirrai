/**
 * The interview for a person with no records (C1.8).
 *
 * The questionnaire asks the same nine questions of everybody. The
 * interview is the other way round: it follows what the person says. The
 * ten aspects it has to cover are a closed set and are asked in a fixed
 * order — the *code* decides which aspect comes next, and the model only
 * puts the question into natural words. That split is the point: a model
 * left to choose is a model that can spend twenty rounds on the same warm
 * memory and never ask what the person was like when they were angry.
 *
 * The interview is a conversation, not a form. An aspect counts as
 * covered after two answers about it; the interview ends at twenty
 * answers, when everything is covered, or the moment the person says
 * 「就这些」.
 */
import { copy, type CopyKey, type Locale } from "@shared/copy";
import { asMaterial } from "@shared/material";
import {
  INTERVIEW_ASPECTS,
  INTERVIEW_MAX_ROUNDS,
  INTERVIEW_ROUNDS_PER_ASPECT,
  type InterviewAspect,
  type InterviewDoneReason,
  type InterviewTurn,
} from "@shared/interview";
import type { LLMMessage } from "../llm/types";

export {
  INTERVIEW_ASPECTS,
  INTERVIEW_MAX_ROUNDS,
  INTERVIEW_ROUNDS_PER_ASPECT,
};
export type { InterviewAspect, InterviewDoneReason, InterviewTurn };

/** The longest question the interviewer may return. */
export const INTERVIEW_QUESTION_MAX_CHARS = 300;

/** The words people use to end an interview early. */
// i18n:allow-input — these are matched against what the person typed.
const DONE_SIGNALS_ZH = ["就这些", "就这些了", "没了", "没有了", "说完了"];
/**
 * The English signals, compared the same way — with the spaces and
 * apostrophes already taken out.
 */
const DONE_SIGNALS_EN = ["thatsall", "thatsit", "nothingelse", "nomore"];

/**
 * Whether an answer means "that is everything".
 *
 * The comparison ignores spaces and the punctuation people put around a
 * short answer, so 「就这些。」 and 「就这些」 are the same sentence.
 */
export function isInterviewDoneSignal(answer: string): boolean {
  const text = String(answer ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s。.!！?？~～,，、'"’]/g, "")
    // Modal particles are how people soften the sentence — the meaning
    // of 「就这些啦」 is 「就这些」.
    .replace(/(?:啦|了|呀|吧|哦|噢|啊)+$/g, "");
  if (!text) return false;
  return DONE_SIGNALS_ZH.includes(text) || DONE_SIGNALS_EN.includes(text);
}

/** The answered turns, in order. */
function answeredTurns(transcript: InterviewTurn[]): InterviewTurn[] {
  return (Array.isArray(transcript) ? transcript : []).filter(
    (turn) => turn && typeof turn.answer === "string" && turn.answer.trim().length > 0,
  );
}

/** How many answers the interview has heard. */
export function answeredRounds(transcript: InterviewTurn[]): number {
  return answeredTurns(transcript).length;
}

/** How many non-empty answers each aspect has had. */
export function aspectAnswerCounts(
  transcript: InterviewTurn[],
): Record<InterviewAspect, number> {
  const counts = {} as Record<InterviewAspect, number>;
  for (const aspect of INTERVIEW_ASPECTS) counts[aspect] = 0;
  for (const turn of answeredTurns(transcript)) {
    if ((INTERVIEW_ASPECTS as readonly string[]).includes(turn.aspect)) {
      counts[turn.aspect] += 1;
    }
  }
  return counts;
}

/** The aspects that have been talked about twice. */
export function coveredAspects(transcript: InterviewTurn[]): InterviewAspect[] {
  const counts = aspectAnswerCounts(transcript);
  return INTERVIEW_ASPECTS.filter((aspect) => counts[aspect] >= INTERVIEW_ROUNDS_PER_ASPECT);
}

/**
 * The first aspect nobody has talked about twice, in the fixed order.
 *
 * This is the decision the model is not allowed to make.
 */
export function firstUncoveredAspect(transcript: InterviewTurn[]): InterviewAspect | null {
  const counts = aspectAnswerCounts(transcript);
  for (const aspect of INTERVIEW_ASPECTS) {
    if (counts[aspect] < INTERVIEW_ROUNDS_PER_ASPECT) return aspect;
  }
  return null;
}

/** Why the interview is over, or null while it goes on. */
export function interviewEndReason(transcript: InterviewTurn[]): InterviewDoneReason | null {
  const turns = Array.isArray(transcript) ? transcript : [];
  if (turns.some((turn) => turn && isInterviewDoneSignal(turn.answer))) {
    return "user-said-done";
  }
  if (firstUncoveredAspect(turns) === null) return "all-covered";
  if (answeredRounds(turns) >= INTERVIEW_MAX_ROUNDS) return "max-rounds";
  return null;
}

/** Whether the interview is over. */
export function isInterviewFinished(transcript: InterviewTurn[]): boolean {
  return interviewEndReason(transcript) !== null;
}

/**
 * The interview so far, as text to read.
 *
 * It is both the material the next question is asked from and the body
 * of the oral account the finished interview is stored as: the words the
 * person actually used, with the interviewer's questions around them.
 */
export function interviewTranscriptText(
  transcript: InterviewTurn[],
  locale: Locale = "zh",
): string {
  return answeredTurns(transcript)
    .map((turn) =>
      [
        copy(locale, "interview.transcriptAsk", { text: String(turn.question ?? "").trim() }),
        copy(locale, "interview.transcriptAnswer", { text: turn.answer.trim() }),
      ].join("\n"),
    )
    .join("\n\n");
}

/** The messages the interviewer asks one question with. */
export function buildInterviewMessages(params: {
  transcript: InterviewTurn[];
  aspect: InterviewAspect;
  locale?: Locale;
}): LLMMessage[] {
  const locale = params.locale ?? "zh";
  const transcript = interviewTranscriptText(params.transcript, locale);
  const material = transcript || copy(locale, "prompts.interviewNothingYet");
  return [
    {
      role: "system",
      content: copy(locale, "prompts.interviewQuestion", {
        aspect: copy(locale, `interview.aspect.${params.aspect}` as CopyKey),
      }),
    },
    { role: "user", content: asMaterial(material, locale) },
  ];
}

/** The model's answer, reduced to one usable question. */
function cleanQuestion(raw: string | null | undefined): string {
  let text = String(raw ?? "").trim();
  if (!text) return "";
  // A model that returns more than the question keeps the first line;
  // the story around it is not the question.
  text = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)[0] ?? "";
  text = text.replace(/^["'「『]+/, "").replace(/["'」』]+$/, "").trim();
  return text.slice(0, INTERVIEW_QUESTION_MAX_CHARS);
}

export interface NextQuestionResult {
  done: boolean;
  /** The aspect the next question is about; null when the interview ended. */
  aspect: InterviewAspect | null;
  question: string;
  /** The 1-based round the question belongs to. */
  round: number;
  reason?: InterviewDoneReason;
}

/**
 * The next question, or the end of the interview.
 *
 * The aspect is decided here, from the transcript; the model only writes
 * the question. Without a model — or if it fails — the interviewer's own
 * question for that aspect is used, so the interview never stalls.
 */
export async function nextQuestion(params: {
  transcript: InterviewTurn[];
  locale?: Locale;
  invoke?: (messages: LLMMessage[]) => Promise<string | null>;
}): Promise<NextQuestionResult> {
  const locale = params.locale ?? "zh";
  const transcript = Array.isArray(params.transcript) ? params.transcript : [];
  const round = answeredRounds(transcript) + 1;
  const reason = interviewEndReason(transcript);
  if (reason) {
    return { done: true, aspect: null, question: "", round, reason };
  }
  const aspect = firstUncoveredAspect(transcript) ?? INTERVIEW_ASPECTS[0];

  let question = "";
  if (params.invoke) {
    try {
      question = cleanQuestion(
        await params.invoke(buildInterviewMessages({ transcript, aspect, locale })),
      );
    } catch {
      question = "";
    }
  }
  if (!question) {
    question = copy(locale, `interview.question.${aspect}` as CopyKey);
  }
  return { done: false, aspect, question, round };
}
