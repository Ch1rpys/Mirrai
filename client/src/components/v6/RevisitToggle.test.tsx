// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { translate } from "@/i18n";

const updateSettings = vi.fn();

vi.mock("@/lib/trpc", () => ({
  trpc: {
    persona: {
      getSettings: { useQuery: () => ({ data: { revisit: true }, refetch: vi.fn() }) },
      updateSettings: {
        useMutation: (options?: any) => ({
          mutate: (input: any) => {
            updateSettings(input);
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
    t: (key: any) => translate("zh", key),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

import RevisitToggle from "./RevisitToggle";

describe("the revisit switch (C6.5)", () => {
  it("turns the question off", () => {
    render(<RevisitToggle personaId={1} />);
    const box = screen.getByRole("checkbox");
    expect(box).toBeChecked();
    fireEvent.click(box);
    expect(updateSettings).toHaveBeenCalledWith({ id: 1, patch: { revisit: false } });
  });

  it("says when it asks", () => {
    render(<RevisitToggle personaId={1} />);
    expect(screen.getByText(translate("zh", "revisit.title"))).toBeInTheDocument();
    expect(screen.getByText(translate("zh", "revisit.note"))).toBeInTheDocument();
  });
});
