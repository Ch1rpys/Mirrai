// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

const save = vi.fn();
const mine = vi.fn();

let entries: any[] = [];

vi.mock("@/lib/trpc", () => ({
  trpc: {
    lexicon: {
      list: { useQuery: () => ({ data: { entries }, refetch: vi.fn() }) },
      save: { useMutation: () => ({ mutate: save, isPending: false }) },
      mine: { useMutation: () => ({ mutate: mine, isPending: false }) },
    },
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

import LexiconEditor from "./LexiconEditor";

describe("the private lexicon editor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    entries = [];
  });

  it("lets the user confirm a mined word", async () => {
    entries = [
      {
        id: "l1",
        term: "咕咕",
        gloss: "放鸽子",
        who: "them",
        count: 15,
        evidence: [{ snippet: "又咕咕了" }],
        source: "auto",
        verified: false,
      },
    ];
    render(<LexiconEditor personaId={1} />);
    await userEvent.click(screen.getByText(translate("zh", "lexicon.confirm")));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][0].entries[0].verified).toBe(true);
  });

  it("lets the user reject a mined word", async () => {
    entries = [
      {
        id: "l1",
        term: "咕咕",
        gloss: "放鸽子",
        who: "them",
        count: 15,
        evidence: [],
        source: "auto",
        verified: false,
      },
    ];
    render(<LexiconEditor personaId={1} />);
    await userEvent.click(screen.getByText(translate("zh", "lexicon.reject")));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][0].entries).toEqual([]);
  });

  it("lets the user add a word by hand", async () => {
    render(<LexiconEditor personaId={1} />);
    await userEvent.type(screen.getByPlaceholderText(translate("zh", "lexicon.term")), "咕咕");
    await userEvent.type(screen.getByPlaceholderText(translate("zh", "lexicon.gloss")), "放鸽子");
    await userEvent.click(screen.getByText(translate("zh", "lexicon.add")));
    await waitFor(() => expect(save).toHaveBeenCalled());
    const sent = save.mock.calls[0][0].entries[0];
    expect(sent.term).toBe("咕咕");
    expect(sent.gloss).toBe("放鸽子");
    expect(sent.source).toBe("manual");
    expect(sent.verified).toBe(true);
  });
});
