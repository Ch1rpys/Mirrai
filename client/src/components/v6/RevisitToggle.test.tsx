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
            : { data: { revisit: true }, isLoading: false, isError: false, refetch },
      },
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
  beforeEach(() => {
    settingsError = false;
    refetch.mockReset();
  });

  it("offers a retry when the switch could not be read", () => {
    settingsError = true;
    render(<RevisitToggle personaId={1} />);
    expect(screen.getByText(translate("zh", "common.loadFailed"))).toBeInTheDocument();
    fireEvent.click(screen.getByText(translate("zh", "common.retry")));
    expect(refetch).toHaveBeenCalled();
  });

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
