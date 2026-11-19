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
          data: {
            id: 1,
            name: "小A",
            analysisStatus: "ready",
            emotionalState: "warm",
            graduationStatus: null,
            personaData: {},
          },
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
    memory: {
      list: { useQuery: () => ({ data: [] }) },
      create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      autoExtract: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    emotion: {
      getReport: { useQuery: () => ({ data: undefined, isError: false, isLoading: false }) },
    },
    useUtils: () => ({
      persona: {
        get: { invalidate: vi.fn() },
        checkGraduation: { invalidate: vi.fn() },
      },
      chat: { getHistory: { invalidate: vi.fn() } },
      client: { mutation: vi.fn() },
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
    Element.prototype.scrollIntoView = vi.fn();
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
