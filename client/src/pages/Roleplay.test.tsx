// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

/**
 * The role swap (C4.4).
 *
 * The page says what the exercise is and shows the limits; it never
 * looks like an ordinary conversation.
 */
const start = vi.fn();
const say = vi.fn();
const end = vi.fn();
let startOptions: any = null;
let sayOptions: any = null;

vi.mock("@/lib/trpc", () => ({
  trpc: {
    persona: {
      get: { useQuery: () => ({ data: { id: 5, name: "小满" }, isLoading: false, isError: false, refetch: vi.fn() }) },
    },
    roleplay: {
      start: {
        useMutation: (options: any) => {
          startOptions = options;
          return { mutate: start, isPending: false };
        },
      },
      say: {
        useMutation: (options: any) => {
          sayOptions = options;
          return { mutate: say, isPending: false };
        },
      },
      end: { useMutation: () => ({ mutate: end, isPending: false }) },
    },
    safety: {
      resources: { useQuery: () => ({ data: { resources: [] }, isError: false, isLoading: false }) },
    },
  },
}));

vi.mock("wouter", () => ({
  useParams: () => ({ id: "5" }),
  useLocation: () => ["/persona/5/roleplay", vi.fn()],
}));

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import Roleplay from "./Roleplay";

describe("the role swap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("says what it is, with the badge and the limits", () => {
    render(<Roleplay />);
    expect(screen.getByText(/现在你是 小满/)).toBeInTheDocument();
    expect(screen.getByText("数字分身")).toBeInTheDocument();
    expect(screen.getByText(/还剩 0:00/)).toBeInTheDocument();
  });

  it("shows the clock the server gave it", async () => {
    const user = userEvent.setup();
    render(<Roleplay />);
    await user.click(screen.getByRole("button", { name: translate("zh", "roleplay.start") }));
    expect(start).toHaveBeenCalledWith({ personaId: 5 });
    act(() => startOptions.onSuccess({ sessionId: 11, remainingSeconds: 900, remainingTurns: 30 }));
    expect(screen.getByText(/还剩 15:00/)).toBeInTheDocument();
    expect(screen.getByText(/还能说 30 轮/)).toBeInTheDocument();
  });

  it("shows both sides of the practice", async () => {
    const user = userEvent.setup();
    render(<Roleplay />);
    await user.click(screen.getByRole("button", { name: translate("zh", "roleplay.start") }));
    act(() => startOptions.onSuccess({ sessionId: 11, remainingSeconds: 900, remainingTurns: 30 }));
    await user.type(screen.getByLabelText(translate("zh", "roleplay.placeholder", { name: "小满" })), "在吗");
    await user.click(screen.getByRole("button", { name: translate("zh", "roleplay.send") }));
    expect(say).toHaveBeenCalledWith({ sessionId: 11, text: "在吗" });
    act(() => sayOptions.onSuccess({ ended: false, reply: "我在。", turns: 1, remainingSeconds: 880 }, { text: "在吗" }));
    expect(screen.getByText("你（小满）")).toBeInTheDocument();
    expect(screen.getByText("按记录重建的「你」")).toBeInTheDocument();
    expect(screen.getByText("我在。")).toBeInTheDocument();
  });

  it("offers the note only after the practice ends", () => {
    render(<Roleplay />);
    expect(screen.queryByLabelText(translate("zh", "roleplay.notePlaceholder"))).toBeNull();
  });
});
