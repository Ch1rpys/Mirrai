// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { translate } from "@/i18n";

vi.mock("@/components/ui/slider", () => ({
  Slider: (props: { "aria-label"?: string; value?: number[]; disabled?: boolean }) => (
    <input
      type="range"
      aria-label={props["aria-label"]}
      value={props.value?.[0] ?? 0}
      disabled={props.disabled}
      readOnly
    />
  ),
}));

const mutate = vi.fn();
const settingsData = { sampling: { temperature: 0.6, topP: 0.9 } };

vi.mock("@/lib/trpc", () => ({
  trpc: {
    persona: {
      getSettings: {
        useQuery: () => ({
          data: settingsData,
          isLoading: false,
          refetch: vi.fn(),
        }),
      },
      updateSettings: {
        useMutation: () => ({ mutate, isPending: false }),
      },
    },
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

import PersonaSampling from "./PersonaSampling";

describe("the persona sampling sliders", () => {
  it("saves the four numbers and can clear them", () => {
    render(<PersonaSampling personaId={5} />);
    expect(screen.getByText("这个分身的采样参数")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存采样参数" }));
    expect(mutate).toHaveBeenCalledWith(
      { id: 5, patch: { sampling: expect.objectContaining({ temperature: 0.6, topP: 0.9 }) } },
      expect.anything(),
    );
    fireEvent.click(screen.getByRole("button", { name: "回到全局设置" }));
    expect(mutate).toHaveBeenCalledWith(
      { id: 5, patch: { sampling: null } },
      expect.anything(),
    );
  });
});
