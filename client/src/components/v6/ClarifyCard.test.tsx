// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

const { answer, refetch } = vi.hoisted(() => ({
  answer: vi.fn(),
  refetch: vi.fn(),
}));

let questions: Array<{
  id: string;
  kind: string;
  prompt: string;
  input: string;
  choices?: Array<{ value: string; label: string }>;
}> = [];

vi.mock("@/lib/trpc", () => ({
  trpc: {
    persona: {
      clarifications: {
        useQuery: () => ({ data: { questions }, isLoading: false, isError: false, refetch }),
      },
      answerClarification: {
        useMutation: () => ({ mutate: answer, isPending: false }),
      },
    },
  },
}));

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

import ClarifyCard from "./ClarifyCard";

describe("the post-distill questions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    questions = [
      { id: "never_says", kind: "never_says", prompt: "有没有哪句话是 小满 绝对不会说的？", input: "skipable-text" },
      { id: "avoid_topic", kind: "avoid_topic", prompt: "有没有 小满 不愿意聊的话题？", input: "skipable-text" },
    ];
  });

  it("advances after an answer", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ClarifyCard personaId={5} name="小满" />);
    expect(screen.getByText(questions[0]!.prompt)).toBeInTheDocument();
    await user.type(screen.getByRole("textbox"), "加油");
    await user.click(screen.getByRole("button", { name: "记下" }));
    expect(answer).toHaveBeenCalledWith({
      id: 5,
      questionId: "never_says",
      answer: "加油",
      skip: false,
    });
    questions = questions.slice(1);
    rerender(<ClarifyCard personaId={5} name="小满" />);
    expect(screen.getByText(questions[0]!.prompt)).toBeInTheDocument();
  });

  it("does not write an answer when skipped", async () => {
    const user = userEvent.setup();
    render(<ClarifyCard personaId={5} name="小满" />);
    await user.click(screen.getByRole("button", { name: "跳过" }));
    expect(answer).not.toHaveBeenCalled();
    expect(screen.getByText(questions[1]!.prompt)).toBeInTheDocument();
  });
});
