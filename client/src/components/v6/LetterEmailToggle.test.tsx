// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { translate } from "@/i18n";

const updateSettings = vi.fn();
const refetch = vi.fn();
let settingsError = false;

vi.mock("@/lib/trpc", () => ({
  trpc: {
    persona: {
      getSettings: {
        useQuery: () =>
          settingsError
            ? { data: undefined, isLoading: false, isError: true, refetch }
            : {
                data: { letterEmail: false },
                isLoading: false,
                isError: false,
                refetch,
              },
      },
      updateSettings: {
        useMutation: () => ({ mutate: updateSettings, isPending: false }),
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

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import LetterEmailToggle from "./LetterEmailToggle";

describe("the per-persona email switch (C5.5)", () => {
  beforeEach(() => {
    settingsError = false;
    refetch.mockReset();
  });

  it("offers a retry when the switch could not be read", () => {
    settingsError = true;
    render(<LetterEmailToggle personaId={5} name="小满" />);
    expect(screen.getByText(translate("zh", "common.loadFailed"))).toBeInTheDocument();
    fireEvent.click(screen.getByText(translate("zh", "common.retry")));
    expect(refetch).toHaveBeenCalled();
  });

  it("sends the switch with the persona's name in the explanation", () => {
    render(<LetterEmailToggle personaId={5} name="小满" />);
    expect(screen.getByText("回信也发到我的邮箱")).toBeInTheDocument();
    expect(screen.getByText(/小满 的回信会经过你填的邮件服务器/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(updateSettings).toHaveBeenCalledWith({
      id: 5,
      patch: { letterEmail: true },
    });
  });
});
