// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { translate } from "@/i18n";

const update = vi.fn();
const refetch = vi.fn();
let settings: any;
let settingsError = false;

vi.mock("@/lib/trpc", () => ({
  trpc: {
    persona: {
      getSettings: {
        useQuery: () =>
          settingsError
            ? { data: undefined, isLoading: false, isError: true, refetch }
            : { data: settings, isLoading: false, isError: false, refetch },
      },
      updateSettings: {
        useMutation: (options?: any) => ({
          mutate: (input: any) => {
            update(input);
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
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

import MemorialSettings from "./MemorialSettings";

describe("the memorial switch (C7.1)", () => {
  beforeEach(() => {
    settingsError = false;
    refetch.mockReset();
  });

  it("offers a retry when the switch could not be read", () => {
    settingsError = true;
    render(<MemorialSettings personaId={1} name="小满" />);
    expect(screen.getByText(translate("zh", "common.loadFailed"))).toBeInTheDocument();
    fireEvent.click(screen.getByText(translate("zh", "common.retry")));
    expect(refetch).toHaveBeenCalled();
  });

  it("turns memorial mode on", () => {
    settings = { mode: "default" };
    render(<MemorialSettings personaId={1} name="小满" />);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(update).toHaveBeenCalledWith({ id: 1, patch: { mode: "memorial" } });
  });

  it("saves the birthday and the deathday, and can clear them", () => {
    settings = { mode: "memorial", memorial: { birthday: "1990-05-21", deathday: "2023-10-02" } };
    render(<MemorialSettings personaId={1} name="小满" />);
    const birthday = screen.getByLabelText(translate("zh", "memorial.birthday"));
    fireEvent.change(birthday, { target: { value: "1991-05-21" } });
    expect(update).toHaveBeenCalledWith({
      id: 1,
      patch: { memorial: { birthday: "1991-05-21", deathday: "2023-10-02" } },
    });

    const deathday = screen.getByLabelText(translate("zh", "memorial.deathday"));
    fireEvent.change(deathday, { target: { value: "" } });
    expect(update).toHaveBeenCalledWith({
      id: 1,
      patch: { memorial: { birthday: "1991-05-21", deathday: null } },
    });
  });

  it("explains what changes, without the leaving-it-behind words in the variants", () => {
    settings = { mode: "default" };
    render(<MemorialSettings personaId={1} name="小满" />);
    expect(screen.getByText(translate("zh", "memorial.title"))).toBeInTheDocument();
    expect(screen.getByText(translate("zh", "memorial.note", { name: "小满" }))).toBeInTheDocument();
  });
});
