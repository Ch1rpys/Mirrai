// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

/**
 * The group chat page (C9.8).
 *
 * The fixed note, the three states of the history read, the mention
 * list, the send, the crisis card, the member notes and the dissolve.
 * The server side is mocked with the frozen contract.
 */
const state = vi.hoisted(() => ({
  history: { value: null as any },
  sendCalls: [] as Array<{ roomId: number; text: string }>,
  deleteCalls: [] as Array<{ roomId: number }>,
  sendResult: null as any,
  sendError: false,
  deleteError: false,
  confirm: vi.fn(),
  navigate: vi.fn(),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("@/lib/trpc", () => ({
  trpc: {
    group: {
      history: { useQuery: () => state.history.value },
      send: {
        useMutation: () => ({
          mutate: (
            input: { roomId: number; text: string },
            options?: { onSuccess?: (data: any) => void; onError?: () => void },
          ) => {
            state.sendCalls.push(input);
            if (state.sendError) options?.onError?.();
            else options?.onSuccess?.(state.sendResult);
          },
          isPending: false,
        }),
      },
      delete: {
        useMutation: () => ({
          mutate: (
            input: { roomId: number },
            options?: { onSuccess?: () => void; onError?: (error: { message: string }) => void },
          ) => {
            state.deleteCalls.push(input);
            if (state.deleteError) options?.onError?.({ message: "nope" });
            else options?.onSuccess?.();
          },
          isPending: false,
        }),
      },
    },
  },
}));

vi.mock("@/components/ConfirmDialog", () => ({
  useConfirm: () => state.confirm,
}));

vi.mock("wouter", () => ({
  useParams: () => ({ id: "5" }),
  useLocation: () => ["/group/5", state.navigate],
}));

vi.mock("sonner", () => ({
  toast: {
    success: (text: string) => toastSuccess(text),
    error: (text: string) => toastError(text),
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

import Group from "./Group";

const MEMBERS = [
  { personaId: 1, name: "小A", avatarUrl: "https://example.test/a.png", hasGroupData: true, available: true },
  { personaId: 2, name: "小B", avatarUrl: null, hasGroupData: false, available: true },
  { personaId: 3, name: "小C", avatarUrl: null, hasGroupData: true, available: false },
];

const MESSAGES = [
  {
    id: 1,
    role: "user",
    personaId: null,
    personaName: null,
    content: "你们在吗",
    createdAt: "2026-03-01T10:00:00.000Z",
  },
  {
    id: 2,
    role: "assistant",
    personaId: 1,
    personaName: "小A",
    content: "在的。",
    createdAt: "2026-03-01T10:01:00.000Z",
  },
];

function loaded(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      room: { id: 5, name: "周末的群", members: MEMBERS },
      messages: MESSAGES,
      nextCursor: null,
    },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  };
}

function loading() {
  return { data: undefined, isLoading: true, isError: false, error: null, refetch: vi.fn() };
}

const inputPlaceholder = () => translate("zh", "group.inputPlaceholder");

describe("the group page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.history.value = loaded();
    state.sendCalls = [];
    state.deleteCalls = [];
    state.sendResult = null;
    state.sendError = false;
    state.deleteError = false;
    state.confirm.mockResolvedValue(true);
  });

  it("always carries the fixed note — loading, failed or loaded", () => {
    state.history.value = loading();
    const first = render(<Group />);
    expect(screen.getByRole("note")).toHaveTextContent(translate("zh", "group.banner"));
    first.unmount();

    state.history.value = { data: undefined, isLoading: false, isError: true, error: null, refetch: vi.fn() };
    const second = render(<Group />);
    expect(screen.getByRole("note")).toHaveTextContent(translate("zh", "group.banner"));
    second.unmount();

    state.history.value = loaded();
    render(<Group />);
    expect(screen.getByRole("note")).toHaveTextContent(translate("zh", "group.banner"));
  });

  it("says it is still reading, not that the room is empty", () => {
    state.history.value = loading();
    render(<Group />);
    expect(screen.getByText(translate("zh", "group.loading"))).toBeInTheDocument();
    expect(screen.queryByText(translate("zh", "group.empty"))).toBeNull();
    expect(screen.queryByText(translate("zh", "group.loadFailed"))).toBeNull();
  });

  it("reports a failed read and offers a retry", async () => {
    const user = userEvent.setup();
    const refetch = vi.fn();
    state.history.value = { data: undefined, isLoading: false, isError: true, error: null, refetch };
    render(<Group />);

    expect(screen.getByText(translate("zh", "group.loadFailed"))).toBeInTheDocument();
    expect(screen.queryByText(translate("zh", "group.empty"))).toBeNull();

    await user.click(screen.getByRole("button", { name: translate("zh", "group.retry") }));
    expect(refetch).toHaveBeenCalled();
  });

  it("says there is no room for a missing id", () => {
    state.history.value = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: { data: { code: "NOT_FOUND" } },
      refetch: vi.fn(),
    };
    render(<Group />);
    expect(screen.getByText(translate("zh", "group.notFound"))).toBeInTheDocument();
    expect(screen.queryByText(translate("zh", "group.loadFailed"))).toBeNull();
  });

  it("renders each message with its name, its avatar and its words", () => {
    const { container } = render(<Group />);
    expect(screen.getByText("你们在吗")).toBeInTheDocument();
    expect(screen.getByText("在的。")).toBeInTheDocument();
    // The user's line is named "你" (the avatar carries the same
    // character); the persona's line carries its name.
    expect(screen.getAllByText(translate("zh", "group.you")).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("小A").length).toBeGreaterThanOrEqual(1);
    // The two sides look different.
    expect(container.querySelectorAll(".bubble-user")).toHaveLength(1);
    expect(container.querySelectorAll(".bubble-ai")).toHaveLength(1);
  });

  it("says the room is empty — not that the read failed", () => {
    state.history.value = loaded({
      data: {
        room: { id: 5, name: "周末的群", members: MEMBERS },
        messages: [],
        nextCursor: null,
      },
    });
    render(<Group />);
    expect(screen.getByText(translate("zh", "group.empty"))).toBeInTheDocument();
    expect(screen.queryByText(translate("zh", "group.loadFailed"))).toBeNull();
    expect(screen.queryByText(translate("zh", "group.loading"))).toBeNull();
  });

  it("keeps the messages when a refresh fails, and says the history is stale", async () => {
    const user = userEvent.setup();
    const refetch = vi.fn();
    state.history.value = loaded({ isError: true, error: null, refetch });
    render(<Group />);
    expect(screen.getByText(translate("zh", "group.historyFailed"))).toBeInTheDocument();
    expect(screen.getByText("在的。")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: translate("zh", "group.retry") }));
    expect(refetch).toHaveBeenCalled();
  });

  it("opens the member list on @ and inserts the picked name", async () => {
    const user = userEvent.setup();
    render(<Group />);

    const input = screen.getByRole("textbox", { name: inputPlaceholder() });
    await user.type(input, "@");

    const list = screen.getByTestId("group-mention-list");
    await user.click(within(list).getByRole("button", { name: "小A" }));

    expect((input as HTMLInputElement).value).toBe("@小A ");
    expect(screen.queryByTestId("group-mention-list")).toBeNull();
  });

  it("sends what was typed and clears the input", async () => {
    const user = userEvent.setup();
    render(<Group />);

    const input = screen.getByRole("textbox", { name: inputPlaceholder() });
    await user.type(input, "晚上好");
    await user.click(screen.getByRole("button", { name: translate("zh", "group.send") }));

    expect(state.sendCalls).toEqual([{ roomId: 5, text: "晚上好" }]);
    expect((input as HTMLInputElement).value).toBe("");
  });

  it("says the message did not go out", async () => {
    const user = userEvent.setup();
    state.sendError = true;
    render(<Group />);
    await user.type(screen.getByRole("textbox", { name: inputPlaceholder() }), "晚上好");
    await user.click(screen.getByRole("button", { name: translate("zh", "group.send") }));
    expect(screen.getByText(translate("zh", "group.sendFailed"))).toBeInTheDocument();
  });

  it("renders a crisis answer as its own safety card, not a persona bubble", async () => {
    const user = userEvent.setup();
    state.sendResult = {
      userMessage: { id: 10, content: "我撑不住了", createdAt: "2026-03-01T10:02:00.000Z" },
      replies: [],
      crisis: { text: "我很担心你。要不要先和身边能帮到你的人说一声？" },
    };
    const { container } = render(<Group />);

    await user.type(screen.getByRole("textbox", { name: inputPlaceholder() }), "我撑不住了");
    await user.click(screen.getByRole("button", { name: translate("zh", "group.send") }));

    const card = screen.getByTestId("group-crisis");
    expect(card).toHaveTextContent(translate("zh", "safety.crisisTitle"));
    expect(card).toHaveTextContent("我很担心你。要不要先和身边能帮到你的人说一声？");
    // The card did not add a persona bubble of its own.
    expect(container.querySelectorAll(".bubble-ai")).toHaveLength(1);
  });

  it("notes the members without group-history data and mutes unavailable ones", () => {
    render(<Group />);
    const members = screen.getByTestId("group-members");
    expect(within(members).getByText(translate("zh", "group.noGroupData"))).toBeInTheDocument();
    expect(members.querySelectorAll('[data-unavailable="true"]')).toHaveLength(1);
    expect(screen.getByText(translate("zh", "group.membersTitle"))).toBeInTheDocument();
    expect(screen.getByText(translate("zh", "group.memberCount", { count: 3 }))).toBeInTheDocument();
  });

  it("asks before dissolving the room and goes back to the lobby", async () => {
    const user = userEvent.setup();
    render(<Group />);

    await user.click(screen.getByRole("button", { name: translate("zh", "group.deleteRoom") }));
    await waitFor(() => expect(state.deleteCalls).toHaveLength(1));

    expect(state.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        description: translate("zh", "group.deleteRoomConfirm"),
        destructive: true,
      }),
    );
    expect(state.deleteCalls).toEqual([{ roomId: 5 }]);
    expect(toastSuccess).toHaveBeenCalledWith(translate("zh", "group.deleted"));
    expect(state.navigate).toHaveBeenCalledWith("/");
  });

  it("keeps the room when the dissolve is declined", async () => {
    const user = userEvent.setup();
    state.confirm.mockResolvedValue(false);
    render(<Group />);
    await user.click(screen.getByRole("button", { name: translate("zh", "group.deleteRoom") }));
    expect(state.deleteCalls).toEqual([]);
    expect(state.navigate).not.toHaveBeenCalled();
  });
});
