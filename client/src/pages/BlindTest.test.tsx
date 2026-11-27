// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

const start = vi.fn();
const answer = vi.fn();
const invite = vi.fn();
let persona = { id: 1, name: "小满" };

vi.mock("@/lib/trpc", () => ({
  trpc: {
    persona: {
      get: {
        useQuery: () => ({ data: persona, isLoading: false, isError: false }),
      },
    },
    blind: {
      start: {
        useMutation: () => ({
          mutateAsync: (...args: unknown[]) => start(...args),
          isPending: false,
        }),
      },
      answer: {
        useMutation: () => ({
          mutateAsync: (...args: unknown[]) => answer(...args),
          isPending: false,
        }),
      },
      invite: {
        useMutation: () => ({
          mutateAsync: (...args: unknown[]) => invite(...args),
          isPending: false,
        }),
      },
      exportRecord: {
        useQuery: () => ({ data: null }),
      },
    },
  },
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ isAuthenticated: true, loading: false }),
}));

vi.mock("wouter", () => ({
  useParams: () => ({ id: "1" }),
  useLocation: () => ["/persona/1/blind-test", vi.fn()],
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

import BlindTest from "./BlindTest";

describe("the owner's blind test", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    start.mockResolvedValue({
      sessionId: 7,
      name: "小满",
      total: 2,
      groups: [
        { first: "第一组上面", second: "第一组下面" },
        { first: "第二组上面", second: "第二组下面" },
      ],
    });
    answer.mockImplementation(async ({ group }: { group: number }) => {
      if (group === 0) return { done: false, answered: 1, total: 2 };
      return {
        done: true,
        summary: { n: 2, pickedReal: 0.5, pickedPersona: 0.5, unsure: 0 },
      };
    });
  });

  it("does not show the next pair until this one is answered", async () => {
    const user = userEvent.setup();
    render(<BlindTest />);
    await user.click(screen.getByRole("button", { name: translate("zh", "fidelity.blind.startSelf") }));
    expect(await screen.findByText("第一组上面")).toBeInTheDocument();
    expect(screen.queryByText("第二组上面")).toBeNull();
    expect(screen.queryByText(/组里，你认出真话/)).toBeNull();

    await user.click(screen.getByRole("button", { name: translate("zh", "fidelity.blind.pickFirst") }));
    expect(screen.getByText("第一组上面")).toBeInTheDocument();
    expect(screen.queryByText("第二组上面")).toBeNull();

    await user.click(screen.getByRole("button", { name: translate("zh", "fidelity.blind.reasonSkip") }));
    expect(await screen.findByText("第二组上面")).toBeInTheDocument();
    expect(screen.queryByText("第一组上面")).toBeNull();
    expect(screen.queryByText(/组里，你认出真话/)).toBeNull();

    await user.click(screen.getByRole("button", { name: translate("zh", "fidelity.blind.pickSecond") }));
    await user.click(screen.getByRole("button", { name: translate("zh", "fidelity.blind.reasonSkip") }));
    await waitFor(() => {
      expect(screen.getByText(/2 组里，你认出真话 1 次/)).toBeInTheDocument();
    });
    expect(screen.queryByText("第二组上面")).toBeNull();
  });

  it("offers the friend invite without waiting for the owner to answer", async () => {
    invite.mockResolvedValue({
      token: "f".repeat(64),
      path: `/blind/${"f".repeat(64)}`,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      sessionId: 7,
    });
    const user = userEvent.setup();
    render(<BlindTest />);
    await user.click(
      screen.getByRole("button", { name: translate("zh", "fidelity.blind.startFriend") }),
    );

    // The friend sitting is the friend's to answer: the owner gets the
    // link, not the pairs.
    expect(start).toHaveBeenCalledWith({ personaId: 1, subject: "friend" });
    expect(screen.queryByText("第一组上面")).toBeNull();

    const button = await screen.findByRole("button", {
      name: translate("zh", "fidelity.blind.invite"),
    });
    expect(screen.queryByText(/组里，你认出真话/)).toBeNull();
    await user.click(button);
    await waitFor(() => expect(invite).toHaveBeenCalledWith({ sessionId: 7 }));
  });
});
