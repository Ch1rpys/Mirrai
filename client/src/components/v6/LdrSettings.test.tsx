// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { translate } from "@/i18n";

const updateSettings = vi.fn();

vi.mock("@/lib/trpc", () => ({
  trpc: {
    persona: {
      getSettings: {
        useQuery: () => ({
          data: { ldr: { nextMeetAt: "2026-03-04", weather: false } },
          isLoading: false,
          refetch: vi.fn(),
        }),
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

import LdrSettings from "./LdrSettings";

describe("the long-distance settings (C5.1)", () => {
  it("shows the saved meeting day and saves a new one", () => {
    render(<LdrSettings personaId={5} />);
    const input = screen.getByLabelText("下次见面") as HTMLInputElement;
    expect(input.value).toBe("2026-03-04");
    fireEvent.change(input, { target: { value: "2026-04-01" } });
    fireEvent.click(screen.getByRole("button", { name: "记下这个日子" }));
    expect(updateSettings).toHaveBeenCalledWith(
      { id: 5, patch: { ldr: { nextMeetAt: "2026-04-01" } } },
      expect.anything(),
    );
  });

  it("clears the day", () => {
    render(<LdrSettings personaId={5} />);
    fireEvent.click(screen.getByRole("button", { name: "清掉这个日子" }));
    expect(updateSettings).toHaveBeenCalledWith(
      { id: 5, patch: { ldr: { nextMeetAt: null } } },
      expect.anything(),
    );
  });
});
