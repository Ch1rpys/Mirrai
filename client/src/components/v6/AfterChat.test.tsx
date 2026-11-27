// @vitest-environment jsdom
import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

/**
 * "How are you after that?" (C4.2)
 *
 * One line, four answers, and nothing that calls the person back: no
 * popup, no push, no dot. The card after three worse answers offers a
 * pause and accepts no for an answer.
 */
const answer = vi.fn();
const acknowledge = vi.fn();
const markPrompted = vi.fn();
const update = vi.fn();
let pendingState: any = { data: { pending: null, worse: false } };

vi.mock("@/lib/trpc", () => ({
  trpc: {
    checkin: {
      pending: { useQuery: () => pendingState },
      answer: {
        useMutation: (options: any) => ({
          mutate: (input: any) => {
            answer(input);
            options?.onSuccess?.();
          },
          isPending: false,
        }),
      },
      acknowledgeWorse: {
        useMutation: (options: any) => ({
          mutate: (input: any) => {
            acknowledge(input);
            options?.onSuccess?.();
          },
          isPending: false,
        }),
      },
      markPrompted: {
        useMutation: () => ({ mutate: markPrompted, isPending: false }),
      },
    },
    persona: {
      update: {
        useMutation: (options: any) => ({
          mutate: (input: any) => {
            update(input);
            options?.onSuccess?.();
          },
          isPending: false,
        }),
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

import AfterChat from "./AfterChat";

const sessionStartAt = "2026-03-10T10:00:00.000Z";

describe("after a conversation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pendingState = { data: { pending: null, worse: false } };
  });

  it("asks once and disappears when any button is pressed", async () => {
    const user = userEvent.setup();
    pendingState = { data: { pending: { sessionStartAt }, worse: false } };
    render(<AfterChat personaId={5} name="小满" />);
    expect(screen.getByText(translate("zh", "afterChat.question"))).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: translate("zh", "afterChat.better") }));
    expect(answer).toHaveBeenCalledWith({ personaId: 5, sessionStartAt, answer: "better" });
    expect(document.querySelector("[data-after-chat]")).toBeNull();
  });

  it("records that the question was shown, so it is not asked again", () => {
    pendingState = { data: { pending: { sessionStartAt }, worse: false } };
    const { unmount } = render(<AfterChat personaId={5} name="小满" />);
    expect(markPrompted).toHaveBeenCalledTimes(1);
    expect(markPrompted).toHaveBeenCalledWith({ personaId: 5, sessionStartAt });
    unmount();
  });

  it("keeps the question while a refetch already says it was shown", async () => {
    pendingState = { data: { pending: { sessionStartAt }, worse: false } };
    const { rerender } = render(<AfterChat personaId={5} name="小满" />);
    expect(screen.getByText(translate("zh", "afterChat.question"))).toBeInTheDocument();
    pendingState = { data: { pending: null, worse: false } };
    rerender(<AfterChat personaId={5} name="小满" />);
    expect(await screen.findByText(translate("zh", "afterChat.question"))).toBeInTheDocument();
  });

  it("sends skipped as an answer too", async () => {
    const user = userEvent.setup();
    pendingState = { data: { pending: { sessionStartAt }, worse: false } };
    render(<AfterChat personaId={5} name="小满" />);
    await user.click(screen.getByRole("button", { name: translate("zh", "afterChat.skipped") }));
    expect(answer).toHaveBeenCalledWith({ personaId: 5, sessionStartAt, answer: "skipped" });
  });

  it("offers a pause after three worse answers, once", () => {
    pendingState = { data: { pending: null, worse: true } };
    render(<AfterChat personaId={5} name="小满" />);
    expect(screen.getByText(translate("zh", "afterChat.worseCard", { name: "小满" }))).toBeInTheDocument();
    expect(acknowledge).toHaveBeenCalledTimes(1);
    expect(acknowledge).toHaveBeenCalledWith({ personaId: 5 });
  });

  it("does not record the pause card as shown before it is drawn", async () => {
    const user = userEvent.setup();
    /**
     * The question is asked first and the card comes after it.
     *
     * The card used to be acknowledged on the query alone, so a visit
     * that only ever showed the question marked the card as shown
     * without drawing it — and a person who did not answer never saw it.
     */
    pendingState = { data: { pending: { sessionStartAt }, worse: true } };
    render(<AfterChat personaId={5} name="小满" />);
    expect(screen.queryByText(translate("zh", "afterChat.worseCard", { name: "小满" }))).toBeNull();
    expect(acknowledge).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: translate("zh", "afterChat.better") }));

    expect(await screen.findByText(translate("zh", "afterChat.worseCard", { name: "小满" }))).toBeInTheDocument();
    expect(acknowledge).toHaveBeenCalledTimes(1);
    expect(acknowledge).toHaveBeenCalledWith({ personaId: 5 });
  });

  it("slows down only when the user says so", async () => {
    const user = userEvent.setup();
    pendingState = { data: { pending: null, worse: true } };
    render(<AfterChat personaId={5} name="小满" />);
    await user.click(screen.getByRole("button", { name: translate("zh", "afterChat.slowDown") }));
    expect(update).toHaveBeenCalledWith({ id: 5, presence: "quiet" });
    expect(document.querySelector("[data-after-chat]")).toBeNull();
  });

  it("cannot push anything", () => {
    const source = readFileSync(path.resolve(__dirname, "AfterChat.tsx"), "utf8");
    expect(source).not.toMatch(/pushToUser|setInterval|Notification/);
  });
});
