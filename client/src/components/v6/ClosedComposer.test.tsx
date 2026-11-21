// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { translate } from "@/i18n";

const updateSettings = vi.fn();
const onRefetch = vi.fn();

vi.mock("@/lib/trpc", () => ({
  trpc: {
    persona: {
      updateSettings: {
        useMutation: (options?: { onSuccess?: () => void }) => ({
          mutate: (input: unknown) => {
            updateSettings(input);
            options?.onSuccess?.();
          },
          isPending: false,
        }),
      },
    },
  },
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { timezone: "Asia/Shanghai" } }),
}));

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

vi.mock("@/components/CrisisCard", () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div>
      <p>危机帮助</p>
      <button onClick={onClose}>关闭帮助</button>
    </div>
  ),
}));

import ClosedComposer from "./ClosedComposer";

describe("the closed composer (C6.1)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("says why the chat is closed", () => {
    render(
      <ClosedComposer personaId={5} name="小满" reason="letters_only" onRefetch={onRefetch} />,
    );
    expect(screen.getByText("现在只写信。这是你自己定的。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "今天破例" })).toBeNull();
  });

  it("lets the user make an exception for today", () => {
    render(
      <ClosedComposer personaId={5} name="小满" reason="weekend_only" onRefetch={onRefetch} />,
    );
    expect(screen.getByText(/今天不是周末/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "今天破例" }));
    expect(updateSettings).toHaveBeenCalledWith({
      id: 5,
      patch: { taper: { overrideDay: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) } },
    });
    expect(onRefetch).toHaveBeenCalled();
  });

  it("keeps the support entrance in every closed state", () => {
    const { rerender } = render(
      <ClosedComposer personaId={5} name="小满" reason="sealed" onRefetch={onRefetch} />,
    );
    expect(screen.getByText(/封存/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "求助信息" }));
    expect(screen.getByText("危机帮助")).toBeInTheDocument();
    fireEvent.click(screen.getByText("关闭帮助"));
    expect(screen.queryByText("危机帮助")).toBeNull();
    rerender(
      <ClosedComposer personaId={5} name="小满" reason="letters_only" onRefetch={onRefetch} />,
    );
    expect(screen.getByRole("button", { name: "求助信息" })).toBeInTheDocument();
  });
});
