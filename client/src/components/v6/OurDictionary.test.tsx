// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

const save = vi.fn();
const refetch = vi.fn();

const entries = [
  {
    id: "l1",
    term: "咕咕",
    gloss: "放鸽子",
    who: "both",
    count: 15,
    firstAt: "2022-03-04T12:00:00.000Z",
    evidence: [{ snippet: "你又咕咕了", at: "2022-03-04T12:00:00.000Z" }],
    source: "auto",
    verified: true,
  },
  {
    id: "l2",
    term: "贴贴",
    gloss: "",
    who: "them",
    count: 5,
    evidence: [{ snippet: "贴贴", at: "2022-05-01T12:00:00.000Z" }],
    source: "auto",
    verified: false,
  },
];

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

let lexiconEntries = entries;

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ persona: { get: { invalidate: vi.fn() } } }),
    persona: {
      get: {
        useQuery: () => ({
          data: { id: 5, name: "小满", personaData: { lexicon: lexiconEntries } },
          isLoading: false,
          isError: false,
          refetch,
        }),
      },
    },
    lexicon: {
      save: { useMutation: () => ({ mutate: save }) },
    },
  },
}));

import OurDictionary from "./OurDictionary";

describe("the dictionary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists a confirmed word with its count and first date", () => {
    render(<OurDictionary personaId={5} />);
    expect(screen.getAllByText(/咕咕/).length).toBeGreaterThan(0);
    expect(screen.getByText(/15/)).toBeInTheDocument();
    expect(screen.getByText(/2022-03-04/)).toBeInTheDocument();
  });

  it("confirms a candidate, with the gloss the user typed", async () => {
    render(<OurDictionary personaId={5} />);
    const gloss = screen.getByLabelText(translate("zh", "report.dictionary.glossPlaceholder"));
    await userEvent.type(gloss, "贴一贴");
    await userEvent.click(screen.getByRole("button", { name: translate("zh", "report.dictionary.confirm") }));
    expect(save).toHaveBeenCalledTimes(1);
    const sent = save.mock.calls[0][0];
    expect(sent.personaId).toBe(5);
    const candidate = sent.entries.find((entry: any) => entry.id === "l2");
    expect(candidate.verified).toBe(true);
    expect(candidate.gloss).toBe("贴一贴");
  });

  it("drops a candidate the user says is not theirs", async () => {
    render(<OurDictionary personaId={5} />);
    await userEvent.click(screen.getByRole("button", { name: translate("zh", "report.dictionary.reject") }));
    const sent = save.mock.calls[0][0];
    expect(sent.entries.map((entry: any) => entry.id)).toEqual(["l1"]);
  });

  it("moves a confirmed candidate above after the query refreshes", async () => {
    const first = render(<OurDictionary personaId={5} />);
    await userEvent.type(
      screen.getByLabelText(translate("zh", "report.dictionary.glossPlaceholder")),
      "贴一贴",
    );
    await userEvent.click(screen.getByRole("button", { name: translate("zh", "report.dictionary.confirm") }));
    expect(save).toHaveBeenCalledTimes(1);
    first.unmount();

    lexiconEntries = entries.map((entry) =>
      entry.id === "l2" ? { ...entry, verified: true, gloss: "贴一贴", source: "manual" } : entry,
    );
    try {
      render(<OurDictionary personaId={5} />);
      // The confirmed entry is now in the confirmed group, so the
      // candidate-only gloss box is gone.
      expect(
        screen.queryByLabelText(translate("zh", "report.dictionary.glossPlaceholder")),
      ).not.toBeInTheDocument();
      expect(screen.getAllByText(/贴贴/).length).toBeGreaterThan(0);
    } finally {
      lexiconEntries = entries;
    }
  });

  it("shows the empty state", () => {
    lexiconEntries = [];
    try {
      render(<OurDictionary personaId={5} />);
      expect(screen.getByText(translate("zh", "report.dictionary.empty"))).toBeInTheDocument();
    } finally {
      lexiconEntries = entries;
    }
  });
});
