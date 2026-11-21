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
            : { data: { taper: { stage: 1 } }, isLoading: false, isError: false, refetch },
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

import TaperPicker from "./TaperPicker";

describe("the four steps down (C6.1)", () => {
  beforeEach(() => {
    settingsError = false;
    refetch.mockReset();
  });

  it("offers a retry when the steps could not be read", () => {
    settingsError = true;
    render(<TaperPicker personaId={5} name="小满" />);
    expect(screen.getByText(translate("zh", "common.loadFailed"))).toBeInTheDocument();
    fireEvent.click(screen.getByText(translate("zh", "common.retry")));
    expect(refetch).toHaveBeenCalled();
  });

  it("shows all four steps and marks the current one", () => {
    render(<TaperPicker personaId={5} name="小满" />);
    expect(screen.getByText("慢慢来")).toBeInTheDocument();
    const current = screen.getByRole("button", { name: "小满 不主动找我" });
    expect(current).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "照常" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "只在周末聊" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "只写信" })).toBeInTheDocument();
  });

  it("goes down and back up", () => {
    render(<TaperPicker personaId={5} name="小满" />);
    fireEvent.click(screen.getByRole("button", { name: "只写信" }));
    expect(updateSettings).toHaveBeenCalledWith({ id: 5, patch: { taper: { stage: 3 } } });
    fireEvent.click(screen.getByRole("button", { name: "照常" }));
    expect(updateSettings).toHaveBeenCalledWith({ id: 5, patch: { taper: { stage: 0 } } });
  });
});
