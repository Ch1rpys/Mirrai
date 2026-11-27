// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

/**
 * The command palette.
 *
 * ⌘K is a promise: everything, in one place. A person looking for
 * something they said six months ago does not remember which
 * conversation it was in — so the search has to cross conversations, and
 * it has to say what kind of thing each result is, because a message and
 * a memory look nothing alike once they are in a list.
 */
const navigate = vi.fn();
let personas: any[] = [];
let results: any[] = [];
let records: any[] = [];
/** Whether the search failed. */
let searchFailed = false;
/** State of the separate records search (C2.2 groups). */
let recordsFailed = false;
let recordsLoading = false;

vi.mock("wouter", () => ({
  useLocation: () => ["/chat", navigate],
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    persona: { list: { useQuery: () => ({ data: personas }) } },
    chat: { searchAll: { useQuery: () => ({ data: results, isError: searchFailed, isFetching: false }) } },
    record: {
      searchAll: {
        useQuery: () => ({ data: records, isError: recordsFailed, isFetching: recordsLoading }),
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

import CommandPalette from "./CommandPalette";

describe("the command palette", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    personas = [];
    results = [];
    records = [];
    searchFailed = false;
    recordsFailed = false;
    recordsLoading = false;
  });

  it("does not tell the user they wrote nothing when the search failed", async () => {
    /**
     * "Nothing found" is a claim about the user's own messages, and it
     * was made because the request failed. The user searched for
     * something they had written, and the app said they had not
     * written it.
     */
    const user = userEvent.setup();
    render(<CommandPalette />);

    await user.keyboard("{Meta>}k{/Meta}");
    await waitFor(() => {
      expect(screen.getByPlaceholderText(translate("zh", "commandPalette.placeholder"))).toBeInTheDocument();
    });

    searchFailed = true;
    await user.type(screen.getByPlaceholderText(translate("zh", "commandPalette.placeholder")), "海边");

    await waitFor(() => {
      expect(screen.getByText(translate("zh", "common.error"))).toBeInTheDocument();
    });
    expect(screen.queryByText(translate("zh", "commandPalette.noResults"))).toBeNull();
  });

  it("does not say nothing was found while the records group is still loading", async () => {
    // The records are a second query; the "searching" and "empty" states
    // only followed the messages query — so during the first keystrokes
    // the palette said there was nothing, then the records arrived.
    const user = userEvent.setup();
    render(<CommandPalette />);
    await user.keyboard("{Meta>}k{/Meta}");
    await waitFor(() => {
      expect(screen.getByPlaceholderText(translate("zh", "commandPalette.placeholder"))).toBeInTheDocument();
    });
    recordsLoading = true;
    await user.type(screen.getByPlaceholderText(translate("zh", "commandPalette.placeholder")), "海边");
    await waitFor(() => {
      expect(screen.getByText(translate("zh", "commandPalette.searching"))).toBeInTheDocument();
    });
    expect(screen.queryByText(translate("zh", "commandPalette.noResults"))).toBeNull();
  });

  it("says the records search failed rather than leaving the group out", async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);
    await user.keyboard("{Meta>}k{/Meta}");
    await waitFor(() => {
      expect(screen.getByPlaceholderText(translate("zh", "commandPalette.placeholder"))).toBeInTheDocument();
    });
    recordsFailed = true;
    await user.type(screen.getByPlaceholderText(translate("zh", "commandPalette.placeholder")), "海边");
    await waitFor(() => {
      expect(screen.getByText(translate("zh", "common.error"))).toBeInTheDocument();
    });
    expect(screen.queryByText(translate("zh", "commandPalette.noResults"))).toBeNull();
  });

  it("folds a hurtful record hit until it is opened (C10.1)", async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);
    await user.keyboard("{Meta>}k{/Meta}");
    await waitFor(() => {
      expect(screen.getByPlaceholderText(translate("zh", "commandPalette.placeholder"))).toBeInTheDocument();
    });
    records = [{
      personaId: 5,
      personaName: "小满",
      recordId: 11,
      content: "你就是个废物",
      timestamp: null,
      harmful: true,
    }];
    await user.type(screen.getByPlaceholderText(translate("zh", "commandPalette.placeholder")), "你");
    await waitFor(() => {
      expect(screen.getByText(translate("zh", "records.folded"))).toBeInTheDocument();
    });
    expect(screen.queryByText("你就是个废物")).toBeNull();
    await user.click(screen.getByRole("button", { name: translate("zh", "records.folded") }));
    expect(screen.getByText(/你就是个废物/)).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("stays out of the way until it is asked for", () => {
    render(<CommandPalette />);
    expect(screen.queryByPlaceholderText(translate("zh", "commandPalette.placeholder"))).toBeNull();
  });

  it("opens on the keyboard shortcut", async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);

    await user.keyboard("{Meta>}k{/Meta}");

    await waitFor(() => {
      expect(screen.getByPlaceholderText(translate("zh", "commandPalette.placeholder"))).toBeInTheDocument();
    });
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);

    await user.keyboard("{Meta>}k{/Meta}");
    await waitFor(() => {
      expect(screen.getByPlaceholderText(translate("zh", "commandPalette.placeholder"))).toBeInTheDocument();
    });

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByPlaceholderText(translate("zh", "commandPalette.placeholder"))).toBeNull();
    });
  });

  it("lists the original lines and jumps to the reader at that row", async () => {
    records = [{
      personaId: 5,
      personaName: "小满",
      recordId: 11,
      content: "我在海边等你",
      timestamp: "2022-03-01T12:00:00.000Z",
    }];
    const user = userEvent.setup();
    render(<CommandPalette />);
    await user.keyboard("{Meta>}k{/Meta}");
    await user.type(screen.getByPlaceholderText(translate("zh", "commandPalette.placeholder")), "海边");
    await waitFor(() => {
      expect(screen.getByText(translate("zh", "commandPalette.records"))).toBeInTheDocument();
    });
    await user.click(screen.getByText("我在海边等你"));
    expect(navigate).toHaveBeenCalledWith("/persona/5/records?at=11");
  });

  it("shows what kind of thing each result is", async () => {
    const user = userEvent.setup();
    results = [
      { id: 1, kind: "message", title: "", content: "在吗", personaName: "小A" },
      { id: 2, kind: "memory", title: "第一次见面", content: "在图书馆门口", personaName: "小A" },
    ];
    render(<CommandPalette />);

    await user.keyboard("{Meta>}k{/Meta}");
    await user.type(screen.getByPlaceholderText(translate("zh", "commandPalette.placeholder")), "见");

    await waitFor(() => {
      expect(screen.getByText("第一次见面")).toBeInTheDocument();
    });
    // A memory and a message are different things. A message is the
    // expected one and needs no label; anything else is marked, so the
    // list cannot be mistaken for a list of things that were said.
    expect(screen.getByText(translate("zh", "commandPalette.kinds.memory"))).toBeInTheDocument();
    expect(screen.queryByText(translate("zh", "commandPalette.kinds.message"))).toBeNull();
  });

  it("lists the personas when there is nothing to search for", async () => {
    const user = userEvent.setup();
    personas = [{ id: 1, name: "小A", relationshipDesc: "前女友" }];
    render(<CommandPalette />);

    await user.keyboard("{Meta>}k{/Meta}");

    await waitFor(() => {
      expect(screen.getByText("小A")).toBeInTheDocument();
    });
  });
});
