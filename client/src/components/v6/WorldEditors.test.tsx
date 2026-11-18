// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

const save = vi.fn();
const mine = vi.fn();

let people: any[] = [];

vi.mock("@/lib/trpc", () => ({
  trpc: {
    people: {
      list: { useQuery: () => ({ data: { people }, refetch: vi.fn() }) },
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

import WorldEditors from "./WorldEditors";

describe("the people editor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    people = [];
  });

  it("lets the user confirm a mined person", async () => {
    people = [
      {
        id: "p1",
        name: "琪琪",
        aliases: [],
        relation: "室友",
        side: "them",
        mentions: 12,
        evidence: [],
        source: "auto",
        verified: false,
      },
    ];
    render(<WorldEditors personaId={1} />);
    await userEvent.click(screen.getByText(translate("zh", "people.confirm")));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][0].people[0].verified).toBe(true);
  });

  it("lets the user reject a mined person", async () => {
    people = [
      {
        id: "p1",
        name: "琪琪",
        aliases: [],
        relation: "室友",
        side: "them",
        mentions: 12,
        evidence: [],
        source: "auto",
        verified: false,
      },
    ];
    render(<WorldEditors personaId={1} />);
    await userEvent.click(screen.getByText(translate("zh", "people.reject")));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][0].people).toEqual([]);
  });

  it("lets the user add a person by hand", async () => {
    render(<WorldEditors personaId={1} />);
    await userEvent.type(screen.getByPlaceholderText(translate("zh", "people.name")), "琪琪");
    await userEvent.type(screen.getByPlaceholderText(translate("zh", "people.relation")), "室友");
    await userEvent.click(screen.getByText(translate("zh", "people.add")));
    await waitFor(() => expect(save).toHaveBeenCalled());
    const sent = save.mock.calls[0][0].people[0];
    expect(sent.name).toBe("琪琪");
    expect(sent.relation).toBe("室友");
    expect(sent.source).toBe("manual");
    expect(sent.verified).toBe(true);
  });

  it("lets the user merge two people", async () => {
    people = [
      {
        id: "a",
        name: "琪琪",
        aliases: [],
        relation: "室友",
        side: "them",
        mentions: 12,
        evidence: [],
        source: "auto",
        verified: true,
      },
      {
        id: "b",
        name: "小琪",
        aliases: [],
        relation: "",
        side: "them",
        mentions: 4,
        evidence: [],
        source: "auto",
        verified: false,
      },
    ];
    render(<WorldEditors personaId={1} />);
    const selects = screen.getAllByLabelText(translate("zh", "people.mergeInto"));
    await userEvent.selectOptions(selects[1]!, "a");
    await waitFor(() => expect(save).toHaveBeenCalled());
    const sent = save.mock.calls[0][0].people as Array<{ name: string; aliases: string[] }>;
    expect(sent).toHaveLength(1);
    expect(sent[0]?.name).toBe("琪琪");
    expect(sent[0]?.aliases).toContain("小琪");
  });
});
