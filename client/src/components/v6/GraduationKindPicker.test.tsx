// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { translate } from "@/i18n";

const updateSettings = vi.fn();

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ persona: { get: { invalidate: vi.fn() } } }),
    persona: {
      getSettings: {
        useQuery: () => ({
          data: { graduationKind: "farewell" },
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

import GraduationKindPicker from "./GraduationKindPicker";

describe("the four endings (C6.6)", () => {
  it("offers all four and saves the one chosen", () => {
    render(<GraduationKindPicker personaId={5} name="小A" />);
    expect(screen.getByText("这一次，是哪一种结束")).toBeInTheDocument();
    const farewell = screen.getByRole("button", { name: /和 小A 告别/ });
    expect(farewell).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: /我们和好了/ }));
    expect(updateSettings).toHaveBeenCalledWith({
      id: 5,
      patch: { graduationKind: "reconciled" },
    });
  });
});
