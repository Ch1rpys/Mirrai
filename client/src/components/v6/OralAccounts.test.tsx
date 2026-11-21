// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { translate } from "@/i18n";

const save = vi.fn();
const extract = vi.fn();
const adjudicate = vi.fn();
const generate = vi.fn();
const invalidatePersona = vi.fn();
const refetch = vi.fn();
let listState: Record<string, unknown> = {};

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      persona: { get: { invalidate: (...a: unknown[]) => invalidatePersona(...a) } },
    }),
    interview: {
      fromOral: {
        useMutation: (options?: any) => ({
          mutate: (input: any) => {
            generate(input);
            options?.onSuccess?.({ personaId: 5, statements: 2, dropped: 0, tellers: ["琪琪"] });
          },
          isPending: false,
        }),
      },
    },
    oral: {
      list: { useQuery: () => listState, },
      save: {
        useMutation: (options?: any) => ({
          mutate: (input: any) => {
            save(input);
            options?.onSuccess?.({});
          },
          isPending: false,
        }),
      },
      extract: {
        useMutation: (options?: any) => ({
          mutate: (input: any) => {
            extract(input);
            options?.onSuccess?.({ created: 1, dropped: 0, repeated: 0, readable: true });
          },
          isPending: false,
        }),
      },
      transcribe: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    memory: {
      adjudicate: {
        useMutation: (options?: any) => ({
          mutate: (input: any) => {
            adjudicate(input);
            options?.onSuccess?.({});
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

import OralAccounts from "./OralAccounts";

function ready(overrides: Record<string, unknown> = {}) {
  return {
    ...overrides,
    data: {
      isOwner: true,
      ownerName: "",
      accounts: [],
      conflicts: [],
      ...((overrides.data as Record<string, unknown>) ?? {}),
    },
    isLoading: false,
    isError: false,
    refetch,
  };
}

describe("what people remember (C7.4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listState = ready();
  });

  it("shows the owner their own draft and the family's submitted account", () => {
    listState = ready({
      data: {
        accounts: [
          { id: 1, tellerName: "阿树", body: "我记得他爱吃面。", submitted: false, mine: true },
          { id: 2, tellerName: "琪琪", body: "他打游戏会摔鼠标。", submitted: true, mine: false },
        ],
      },
    });
    render(<OralAccounts personaId={5} name="小满" />);

    expect(screen.getByText(translate("zh", "oral.ownerNote", { name: "小满" }))).toBeInTheDocument();
    expect(screen.getByText("我记得他爱吃面。")).toBeInTheDocument();
    expect(screen.getByText("他打游戏会摔鼠标。")).toBeInTheDocument();
    expect(screen.getByText(translate("zh", "oral.draft"))).toBeInTheDocument();
    expect(screen.getByText(translate("zh", "oral.submitted"))).toBeInTheDocument();
    expect(screen.getByText(translate("zh", "oral.mine"))).toBeInTheDocument();
    expect(screen.getByText(translate("zh", "oral.family"))).toBeInTheDocument();
  });

  it("tells a family member that the owner will read what they submit, and offers no extraction", () => {
    listState = ready({
      data: {
        isOwner: false,
        ownerName: "阿树",
        accounts: [{ id: 3, tellerName: "小满的妹妹", body: "他很怕黑。", submitted: true, mine: true }],
      },
    });
    render(<OralAccounts personaId={11} name="小满" />);

    expect(
      screen.getByText(
        translate("zh", "oral.familyNote", { name: "小满", owner: "阿树" }),
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(translate("zh", "oral.extract"))).toBeNull();
    expect(screen.queryByText(translate("zh", "oral.extractHint", { name: "小满" }))).toBeNull();
  });

  it("submits what was typed", () => {
    render(<OralAccounts personaId={5} name="小满" />);
    fireEvent.change(screen.getByPlaceholderText(translate("zh", "oral.hint", { name: "小满" })), {
      target: { value: "小满讨厌香菜。" },
    });
    fireEvent.click(screen.getByText(translate("zh", "oral.submit")));
    expect(save).toHaveBeenCalledWith({
      personaId: 5,
      id: undefined,
      body: "小满讨厌香菜。",
      submit: true,
    });
  });

  it("keeps a draft without submitting it", () => {
    render(<OralAccounts personaId={5} name="小满" />);
    fireEvent.change(screen.getByPlaceholderText(translate("zh", "oral.hint", { name: "小满" })), {
      target: { value: "还没想好怎么说。" },
    });
    fireEvent.click(screen.getByText(translate("zh", "oral.saveDraft")));
    expect(save).toHaveBeenCalledWith({
      personaId: 5,
      id: undefined,
      body: "还没想好怎么说。",
      submit: false,
    });
  });

  it("turns submitted accounts into memories only from the owner's button", () => {
    listState = ready({
      data: {
        accounts: [{ id: 2, tellerName: "琪琪", body: "他怕黑。", submitted: true, mine: false }],
      },
    });
    render(<OralAccounts personaId={5} name="小满" />);
    fireEvent.click(screen.getByText(translate("zh", "oral.extract")));
    expect(extract).toHaveBeenCalledWith({ personaId: 5 });
  });

  it("shows a disagreement and lets the owner pick a side", () => {
    listState = ready({
      data: {
        accounts: [{ id: 2, tellerName: "琪琪", body: "他怕黑。", submitted: true, mine: false }],
        conflicts: [
          {
            key: "coriander",
            items: [
              { id: 7, title: "讨厌香菜。", description: "来自 阿树 的讲述：「讨厌香菜」" },
              { id: 8, title: "喜欢香菜。", description: "来自 琪琪 的讲述：「加香菜」" },
            ],
          },
        ],
      },
    });
    render(<OralAccounts personaId={5} name="小满" />);

    expect(
      screen.getByText(translate("zh", "oral.conflictTitle", { topic: "讨厌香菜。" })),
    ).toBeInTheDocument();
    fireEvent.click(screen.getAllByText(translate("zh", "oral.keepThis"))[0]);
    expect(adjudicate).toHaveBeenCalledWith({ personaId: 5, winnerId: 7, loserId: 8 });
  });

  it("offers the owner the interview's generation path over the submitted accounts (C7.4 step 5)", () => {
    listState = ready({
      data: {
        accounts: [{ id: 2, tellerName: "琪琪", body: "他怕黑。", submitted: true, mine: false }],
      },
    });
    render(<OralAccounts personaId={5} name="小满" />);
    expect(screen.getByText(translate("zh", "oral.generate"))).toBeInTheDocument();
    fireEvent.click(screen.getByText(translate("zh", "oral.generate")));
    expect(generate).toHaveBeenCalledWith({ personaId: 5 });
    expect(invalidatePersona).toHaveBeenCalled();
  });

  it("does not offer the generation path to a family member", () => {
    listState = ready({
      data: {
        isOwner: false,
        ownerName: "阿树",
        accounts: [{ id: 3, tellerName: "小满的妹妹", body: "他很怕黑。", submitted: true, mine: true }],
      },
    });
    render(<OralAccounts personaId={11} name="小满" />);
    expect(screen.queryByText(translate("zh", "oral.generate"))).toBeNull();
  });

  it("says nobody has said anything yet", () => {
    render(<OralAccounts personaId={5} name="小满" />);
    expect(screen.getByText(translate("zh", "oral.empty", { name: "小满" }))).toBeInTheDocument();
  });

  it("offers a retry when the list could not be read", () => {
    listState = { data: undefined, isLoading: false, isError: true, refetch };
    render(<OralAccounts personaId={5} name="小满" />);
    expect(screen.getByText(translate("zh", "oral.loadFailed"))).toBeInTheDocument();
    fireEvent.click(screen.getByText(translate("zh", "common.retry")));
    expect(refetch).toHaveBeenCalled();
  });
});
