// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

/**
 * Sending while a reply is still arriving.
 *
 * A later line used to be refused because the composer was locked. The
 * later line now goes out, and if the server takes the earlier turn
 * away, only that turn's streaming bubble disappears.
 */

const history: unknown[] = [];
const chatPersona = vi.hoisted(() => ({
  value: {
    id: 1,
    name: "小A",
    analysisStatus: "ready",
    emotionalState: "warm",
    graduationStatus: null,
    personaData: {},
  } as Record<string, unknown>,
}));

const markAdd = vi.fn();
const markRemove = vi.fn();
const streamChat = vi.fn();

vi.mock("@/lib/chat-stream", () => ({
  streamChat: (...a: unknown[]) => streamChat(...a),
  isStreamingUnsupported: () => false,
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    letter: { todos: { useQuery: () => ({ data: { todos: [] } }) } },
    persona: {
      get: {
        useQuery: () => ({
          data: chatPersona.value,
          isError: false,
          error: null,
          refetch: vi.fn(),
        }),
      },
      awaken: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      checkGraduation: { useQuery: () => ({ data: { status: null } }) },
      getIntimacy: { useQuery: () => ({ data: null }) },
      graduationMode: { useQuery: () => ({ data: { mode: "suggest" } }) },
      update: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      updateSettings: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      graduate: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      declineGraduation: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    usage: {
      // The budget notice above the composer (C8.9).
      budget: { useQuery: () => ({ data: { over: false } }) },
    },
    chat: {
      markRead: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      getHistory: {
        useQuery: () => ({
          data: history,
          isError: false,
          refetch: vi.fn(),
        }),
      },
      clear: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      updateMessage: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      deleteMessage: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      restoreMessage: { useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }) },
      export: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      tts: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      voices: { useQuery: () => ({ data: { voices: [] } }) },
      search: { useQuery: () => ({ data: [] }) },
      pendingReply: {
        useQuery: () => ({
          data: null,
          isError: false,
          isLoading: false,
          refetch: vi.fn(),
        }),
      },
      replyNow: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    scene: {
      list: { useQuery: () => ({ data: [] }) },
      activate: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      deactivate: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      delete: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    fidelity: {
      mark: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    checkin: {
      pending: { useQuery: () => ({ data: { pending: null, worse: false } }) },
      answer: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      acknowledgeWorse: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      markPrompted: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    outbound: {
      list: { useQuery: () => ({ data: { letters: [] }, refetch: vi.fn() }) },
      addFromMessage: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    memory: {
      list: { useQuery: () => ({ data: [] }) },
      create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      autoExtract: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    emotion: {
      getReport: { useQuery: () => ({ data: undefined, isError: false, isLoading: false }) },
    },
    relationship: {
      add: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    ldr: {
      status: { useQuery: () => ({ data: { enabled: true } }) },
      weather: { useQuery: () => ({ data: null }) },
    },
    scheduled: {
      list: { useQuery: () => ({ data: { items: [] }, isError: false }) },
      create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    mark: {
      // Stars, pins and topics (C8.10).
      list: { useQuery: () => ({ data: { marks: [], maxPins: 3 } }) },
      add: { useMutation: () => ({ mutate: markAdd, isPending: false }) },
      remove: { useMutation: () => ({ mutate: markRemove, isPending: false }) },
    },
    useUtils: () => ({
      persona: {
        get: { invalidate: vi.fn() },
        checkGraduation: { invalidate: vi.fn() },
      },
      chat: {
        getHistory: { invalidate: vi.fn() },
        pendingReply: { invalidate: vi.fn() },
        markRead: { invalidate: vi.fn() },
      },
      client: { mutation: vi.fn() },
      scheduled: { list: { invalidate: vi.fn() } },
      letter: {
        unreadCount: { invalidate: vi.fn() },
        inbox: { invalidate: vi.fn() },
      },
      mark: { list: { invalidate: vi.fn() } },
    }),
  },
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  // An id matters: the draft is stored per user, and without one the
  // page wrote `mirrai:draft:anon:1` while the test looked for `:1:1`.
  useAuth: () => ({ isAuthenticated: true, user: { id: 1, timezone: "Asia/Shanghai" } }),
}));

vi.mock("wouter", () => ({
  useParams: () => ({ id: "1" }),
  useLocation: () => ["/chat/1", vi.fn()],
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

vi.mock("@/components/ConfirmDialog", () => ({
  useConfirm: () => async () => true,
}));

vi.mock("streamdown", () => ({
  Streamdown: ({ children }: { children?: unknown }) => <div>{children as any}</div>,
  defaultRehypePlugins: { harden: {}, raw: {}, katex: {} },
}));

import Chat from "./Chat";

describe("Chat", () => {
  beforeEach(() => {
    streamChat.mockReset();
    history.length = 0;
    delete chatPersona.value.settings;
    Element.prototype.scrollIntoView = vi.fn();
    localStorage.clear();
    markAdd.mockReset();
    markRemove.mockReset();
  });

  it("wears the skin and the note the user chose, and keeps the badge", () => {
    chatPersona.value.settings = { skin: { theme: "im-green", alias: "阿满" } };
    const { container } = render(<Chat />);
    const root = container.querySelector(".chat-root");
    expect(root?.getAttribute("data-skin")).toBe("im-green");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("阿满");
    expect(screen.getByText("数字分身")).toBeInTheDocument();
  });

  it("wears the blue layout and keeps the badge", () => {
    chatPersona.value.settings = { skin: { theme: "im-blue" } };
    const { container } = render(<Chat />);
    expect(container.querySelector(".chat-root")?.getAttribute("data-skin")).toBe("im-blue");
    expect(screen.getByText("数字分身")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("小A");
  });

  it("is the classic layout by default", () => {
    const { container } = render(<Chat />);
    expect(container.querySelector(".chat-root")?.getAttribute("data-skin")).toBe("classic");
    expect(screen.getByText("数字分身")).toBeInTheDocument();
  });

  it("turns itself down when the server says it is the middle of the night (C10.5)", async () => {
    streamChat.mockImplementation(async (options: {
      callbacks: {
        onDelta?: (text: string) => void;
        onDone?: (info: Record<string, unknown>) => void;
      };
    }) => {
      options.callbacks.onDelta?.("晚安");
      options.callbacks.onDone?.({
        messageId: 7,
        emotionalState: "warm",
        graduationSuggested: false,
        careNote: null,
        crisis: false,
        lateNight: true,
      });
    });
    const user = userEvent.setup();
    const { container } = render(<Chat />);
    expect(container.querySelector(".chat-root")?.getAttribute("data-night")).toBeNull();

    await user.type(screen.getByRole("textbox", { name: "对 小A 说点什么..." }), "在吗");
    await user.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => {
      expect(container.querySelector(".chat-root")?.getAttribute("data-night")).toBe("true");
    });
  });

  it("shows the underline legend only when the setting is on (C10.7)", async () => {
    const off = render(<Chat />);
    expect(screen.queryByText(/带下划线的是 小A 真的说过的/)).toBeNull();
    off.unmount();

    localStorage.setItem("mirrai.provenance", "on");
    render(<Chat />);
    expect(screen.getByText(/带下划线的是 小A 真的说过的/)).toBeInTheDocument();
  });

  it("toggles the underline setting from the more menu (C10.7)", async () => {
    const user = userEvent.setup();
    render(<Chat />);
    await user.click(screen.getByRole("button", { name: "更多操作" }));
    await user.click(screen.getByRole("button", { name: "在分身的话里标出 小A 的原话" }));
    expect(localStorage.getItem("mirrai.provenance")).toBe("on");
    expect(screen.getByText(/带下划线的是 小A 真的说过的/)).toBeInTheDocument();
  });

  it("puts the recordings entry in the header only for a memorial persona (C7.3)", () => {
    const label = translate("zh", "media.voicesEntry", { name: "小A" });
    const first = render(<Chat />);
    expect(screen.queryByRole("button", { name: label })).toBeNull();
    first.unmount();
    chatPersona.value.settings = { mode: "memorial" };
    render(<Chat />);
    expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
  });

  it("keeps the way-out entry in the more menu, with its count", async () => {
    const user = userEvent.setup();
    render(<Chat />);
    await user.click(screen.getByRole("button", { name: translate("zh", "chat.moreActions") }));
    expect(
      screen.getByRole("button", {
        name: translate("zh", "chat.outboundEntry", { name: "小A", n: 0 }),
      }),
    ).toBeInTheDocument();
  });

  it("closes the composer and keeps a way to get help (C6.1)", async () => {
    const user = userEvent.setup();
    chatPersona.value.settings = { taper: { stage: 3 } };
    render(<Chat />);
    expect(screen.getByText("现在只写信。这是你自己定的。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "求助信息" })).toBeInTheDocument();
    expect(document.querySelector("#chat-composer")).toBeNull();
    // The rehearsal room is closed with the chat, so its door is gone too.
    await user.click(screen.getByRole("button", { name: translate("zh", "chat.moreActions") }));
    expect(
      screen.queryByRole("button", { name: translate("zh", "rehearsal.title") }),
    ).toBeNull();
  });

  it("lets the composer take another line while a reply is still arriving", async () => {
    streamChat.mockImplementation(() => new Promise(() => {}));
    const user = userEvent.setup();
    render(<Chat />);

    const composer = screen.getByRole("textbox", { name: "对 小A 说点什么..." });
    expect(composer).not.toBeDisabled();
    await user.type(composer, "一");
    await user.click(screen.getByRole("button", { name: "发送" }));

    expect(streamChat).toHaveBeenCalledTimes(1);
    const composerAfter = screen.getByRole("textbox", { name: "对 小A 说点什么..." });
    expect(composerAfter).not.toBeDisabled();
    await user.type(composerAfter, "二");
    expect(screen.getByRole("button", { name: "发送" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "发送" }));
    expect(streamChat).toHaveBeenCalledTimes(2);
  });

  it("drops the streaming bubble and keeps the user's when the turn is taken away", async () => {
    let superseded = () => {};
    streamChat.mockImplementation(async (options: { callbacks: { onDelta: (text: string) => void; onSuperseded?: () => void } }) => {
      options.callbacks.onDelta("在");
      await new Promise<void>((resolve) => {
        superseded = () => {
          options.callbacks.onSuperseded?.();
          resolve();
        };
      });
    });
    const user = userEvent.setup();
    render(<Chat />);

    const composer = screen.getByRole("textbox", { name: "对 小A 说点什么..." });
    await user.type(composer, "一");
    await user.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => {
      expect(screen.getByText("一")).toBeInTheDocument();
      expect(screen.getByText("在")).toBeInTheDocument();
    });
    superseded();
    await waitFor(() => {
      expect(screen.queryByText("在")).toBeNull();
    });
    expect(screen.getByText("一")).toBeInTheDocument();
  });
});

/**
 * The unsent words (C8.10).
 *
 * The composer's text lived only in React state: a reload, or a switch
 * to another persona, threw it away. It is kept per conversation now,
 * and sending is what clears it.
 */
describe("the composer's draft", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    localStorage.clear();
  });

  it("survives a reload, and goes away once it is sent", async () => {
    const user = userEvent.setup();
    const first = render(<Chat />);
    const composer = screen.getByRole("textbox", { name: "对 小A 说点什么..." });
    await user.type(composer, "还没说完的话");
    first.unmount();

    streamChat.mockImplementation(async () => {});
    render(<Chat />);
    const again = screen.getByRole("textbox", { name: "对 小A 说点什么..." });
    expect((again as HTMLTextAreaElement).value).toBe("还没说完的话");
    // It really is this user's draft, not a key that never existed.
    expect(localStorage.getItem("mirrai:draft:1:1")).toBe("还没说完的话");

    await user.click(screen.getByLabelText(translate("zh", "chat.send")));
    expect(localStorage.getItem("mirrai:draft:1:1")).toBeNull();
  });
});

/**
 * A stretch of the record quoted into a turn (C8.10).
 *
 * The reader leaves the quotation in sessionStorage and the URL says
 * only that there is one. The chat shows what is quoted above the
 * composer, sends the ids with the turn, and lets go of the quotation
 * once it has been spent.
 */
describe("a quoted stretch of the record", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    localStorage.clear();
    sessionStorage.clear();
    streamChat.mockReset();
  });

  it("shows the quotation, sends its ids, and clears it", async () => {
    sessionStorage.setItem("mirrai:quote:1", JSON.stringify([
      { id: 101, role: "user", speaker: "阿树", content: "说好的 周末看电影", timestamp: "2023-05-01T12:00:00.000Z" },
      { id: 102, role: "assistant", speaker: "小满", content: "好啊", timestamp: "2023-05-01T12:01:00.000Z" },
    ]));
    window.history.replaceState({}, "", "/chat/1?quote=1");
    streamChat.mockImplementation(async () => {});
    const user = userEvent.setup();
    render(<Chat />);

    expect(screen.getByText(/2 句记录/)).toBeInTheDocument();
    const composer = screen.getByRole("textbox", { name: "对 小A 说点什么..." });
    await user.type(composer, "还记得这个吗");
    await user.click(screen.getByLabelText(translate("zh", "chat.send")));

    expect(streamChat).toHaveBeenCalledWith(expect.objectContaining({
      quotedRecordIds: [101, 102],
    }));
    expect(sessionStorage.getItem("mirrai:quote:1")).toBeNull();
    // The bar is gone; the quotation is now part of the sent message.
    expect(screen.queryByLabelText(translate("zh", "chat.removeQuote"))).toBeNull();
    expect(screen.getAllByText(/2 句记录/).length).toBeGreaterThan(0);
  });
});
