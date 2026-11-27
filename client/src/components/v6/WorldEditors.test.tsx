// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

const save = vi.fn();
const mine = vi.fn();
const saveStance = vi.fn();
const mineStance = vi.fn();

let people: any[] = [];
let stances: any[] = [];

vi.mock("@/lib/trpc", () => ({
  trpc: {
    people: {
      list: { useQuery: () => ({ data: { people }, refetch: vi.fn() }) },
      save: { useMutation: () => ({ mutate: save, isPending: false }) },
      mine: { useMutation: () => ({ mutate: mine, isPending: false }) },
    },
    stance: {
      list: { useQuery: () => ({ data: { stances }, refetch: vi.fn() }) },
      save: { useMutation: () => ({ mutate: saveStance, isPending: false }) },
      mine: { useMutation: () => ({ mutate: mineStance, isPending: false }) },
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

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 1, timezone: "Asia/Shanghai" } }),
}));

import WorldEditors from "./WorldEditors";

beforeEach(() => {
  vi.clearAllMocks();
  people = [];
  stances = [];
});

describe("the people editor", () => {

  it("lets the user confirm a mined person", async () => {
    people = [
      {
        id: "p1",
        name: "琪琪",
        aliases: [],
        relation: "室友",
        side: "them",
        mentions: 12,
        evidence: [{ at: "2022-03-01T04:00:00.000Z", snippet: "琪琪今天也在" }],
        source: "auto",
        verified: false,
      },
    ];
    render(<WorldEditors personaId={1} />);
    expect(screen.getByText(/琪琪今天也在/)).toBeInTheDocument();
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

describe("the stances editor", () => {
  it("lets the user confirm a mined stance", async () => {
    stances = [
      {
        id: "s1",
        topic: "香菜",
        polarity: "dislike",
        statement: "讨厌香菜",
        evidence: [{ at: "2022-03-02T04:00:00.000Z", snippet: "我讨厌香菜" }],
        source: "auto",
        verified: false,
      },
    ];
    render(<WorldEditors personaId={1} />);
    expect(screen.getByText(/我讨厌香菜/)).toBeInTheDocument();
    await userEvent.click(screen.getByText(translate("zh", "stances.confirm")));
    await waitFor(() => expect(saveStance).toHaveBeenCalled());
    expect(saveStance.mock.calls[0][0].stances[0].verified).toBe(true);
  });

  it("lets the user add a stance by hand", async () => {
    render(<WorldEditors personaId={1} />);
    await userEvent.type(screen.getByPlaceholderText(translate("zh", "stances.topic")), "香菜");
    await userEvent.type(screen.getByPlaceholderText(translate("zh", "stances.statement")), "讨厌香菜");
    await userEvent.click(screen.getByText(translate("zh", "stances.add")));
    await waitFor(() => expect(saveStance).toHaveBeenCalled());
    const sent = saveStance.mock.calls[0][0].stances[0];
    expect(sent.topic).toBe("香菜");
    expect(sent.statement).toBe("讨厌香菜");
    expect(sent.polarity).toBe("dislike");
    expect(sent.source).toBe("manual");
    expect(sent.verified).toBe(true);
  });
});
