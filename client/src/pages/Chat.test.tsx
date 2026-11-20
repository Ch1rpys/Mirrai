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
    chat: {
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
    useUtils: () => ({
      persona: {
        get: { invalidate: vi.fn() },
        checkGraduation: { invalidate: vi.fn() },
      },
      chat: {
        getHistory: { invalidate: vi.fn() },
        pendingReply: { invalidate: vi.fn() },
      },
      client: { mutation: vi.fn() },
      scheduled: { list: { invalidate: vi.fn() } },
    }),
  },
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ isAuthenticated: true, user: { timezone: "Asia/Shanghai" } }),
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

  it("closes the composer and keeps a way to get help (C6.1)", () => {
    chatPersona.value.settings = { taper: { stage: 3 } };
    render(<Chat />);
    expect(screen.getByText("现在只写信。这是你自己定的。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "求助信息" })).toBeInTheDocument();
    expect(document.querySelector("#chat-composer")).toBeNull();
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
