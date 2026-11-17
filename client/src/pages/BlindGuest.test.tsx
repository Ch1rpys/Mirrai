// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

const guestAnswer = vi.fn();
let load: {
  name: string;
  groups: Array<{ first: string; second: string }>;
} = { name: "小满", groups: [] };

vi.mock("@/lib/trpc", () => ({
  trpc: {
    blind: {
      guestLoad: {
        useQuery: () => ({ data: load, isLoading: false, isError: false }),
      },
      guestAnswer: {
        useMutation: () => ({
          mutateAsync: (...args: unknown[]) => guestAnswer(...args),
          isPending: false,
        }),
      },
    },
  },
}));

vi.mock("wouter", () => ({
  useParams: () => ({ token: "a".repeat(32) }),
}));

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

import BlindGuest from "./BlindGuest";

describe("the guest blind test", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    load = {
      name: "小满",
      groups: [
        { first: "访客第一上", second: "访客第一下" },
        { first: "访客第二上", second: "访客第二下" },
      ],
    };
    guestAnswer.mockImplementation(async ({ group }: { group: number }) => {
      if (group === 0) return { done: false, answered: 1, total: 2 };
      return {
        done: true,
        summary: { n: 2, pickedReal: 1, pickedPersona: 0, unsure: 0 },
      };
    });
  });

  it("does not show the next pair until this one is answered", async () => {
    const user = userEvent.setup();
    render(<BlindGuest />);
    expect(screen.getByText("访客第一上")).toBeInTheDocument();
    expect(screen.queryByText("访客第二上")).toBeNull();
    expect(screen.queryByText(/组里，你认出真话/)).toBeNull();

    await user.click(screen.getByRole("button", { name: translate("zh", "fidelity.blind.pickFirst") }));
    expect(screen.queryByText("访客第二上")).toBeNull();

    await user.click(screen.getByRole("button", { name: translate("zh", "fidelity.blind.reasonSkip") }));
    expect(await screen.findByText("访客第二上")).toBeInTheDocument();
    expect(screen.queryByText("访客第一上")).toBeNull();

    await user.click(screen.getByRole("button", { name: translate("zh", "fidelity.blind.pickUnsure") }));
    await user.click(screen.getByRole("button", { name: translate("zh", "fidelity.blind.reasonSkip") }));
    await waitFor(() => {
      expect(screen.getByText(/2 组里，你认出真话 2 次/)).toBeInTheDocument();
    });
    expect(screen.queryByText("访客第二上")).toBeNull();
  });
});
