/**
 * The closed set of things the interview asks about (C1.8).
 *
 * It lives in `shared/` because the client has to send its transcript
 * back with the aspect each answer was about — and the type that says
 * which aspects exist should be one type, not two.
 */
export const INTERVIEW_ASPECTS = [
  "address",
  "catchphrase",
  "happy",
  "angry",
  "comfort",
  "routine",
  "likes",
  "people",
  "story",
  "neverSay",
] as const;

export type InterviewAspect = (typeof INTERVIEW_ASPECTS)[number];

/** One aspect is covered once it has been talked about this many times. */
export const INTERVIEW_ROUNDS_PER_ASPECT = 2;

/** The most questions one interview asks. */
export const INTERVIEW_MAX_ROUNDS = 20;

/** One answered turn of the interview. */
export interface InterviewTurn {
  /** The aspect the question was about. The code chose it. */
  aspect: InterviewAspect;
  question: string;
  answer: string;
}

/** Why the interview ended. */
export type InterviewDoneReason = "user-said-done" | "max-rounds" | "all-covered";
