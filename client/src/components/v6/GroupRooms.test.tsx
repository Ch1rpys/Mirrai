// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

/**
 * The lobby's room dialog (C9.8).
 *
 * It lists the rooms, opens one, dissolves one after asking, and makes
 * a room from a name and two to five analysed personas. The three
 * states of the list are all said: still reading, failed with a retry,
 * and honestly empty.
 */
const state = vi.hoisted(() => ({
  rooms: null as any,
  personas: null as any,
  creates: [] as Array<{ name: string; personaIds: number[] }>,
  deletes: [] as Array<{ roomId: number }>,
  createResult: { id: 42 } as { id: number } | null,
  createError: false,
  deleteError: false,
  listRefetch: vi.fn(),
  personaRefetch: vi.fn(),
  confirm: vi.fn(),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("@/lib/trpc", () => ({
  trpc: {
    group: {
      list: { useQuery: () => state.rooms },
      create: {
        useMutation: () => ({
          mutate: (
            input: { name: string; personaIds: number[] },
            options?: { onSuccess?: (created: { id: number } | null) => void; onError?: () => void },
          ) => {
            state.creates.push(input);
            if (state.createError) options?.onError?.();
            else options?.onSuccess?.(state.createResult);
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
            state.deletes.push(input);
            if (state.deleteError) options?.onError?.({ message: "nope" });
            else options?.onSuccess?.();
          },
          isPending: false,
        }),
      },
    },
    persona: { list: { useQuery: () => state.personas } },
  },
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 1, features: { groupChat: true } } }),
}));

vi.mock("@/components/ConfirmDialog", () => ({
  useConfirm: () => state.confirm,
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

import { GroupRooms } from "./GroupRooms";

const MEMBER_A = {
  personaId: 1,
  name: "小A",
  avatarUrl: null,
  hasGroupData: true,
  available: true,
};
const MEMBER_B = {
  personaId: 2,
  name: "小B",
  avatarUrl: null,
  hasGroupData: false,
  available: true,
};

const ROOM = {
  id: 7,
  name: "我们的群",
  createdAt: "2026-03-01T10:00:00.000Z",
  members: [MEMBER_A, MEMBER_B],
  lastMessage: { content: "在吗", createdAt: "2026-03-02T10:00:00.000Z", personaName: "小A" },
};

const READY_PERSONAS = ["小A", "小B", "小C", "小D", "小E", "小F"].map((name, index) => ({
  id: index + 1,
  name,
  analysisStatus: "ready",
}));

function renderDialog() {
  const onOpenChange = vi.fn();
  const onOpenRoom = vi.fn();
  render(<GroupRooms open onOpenChange={onOpenChange} onOpenRoom={onOpenRoom} />);
  return { onOpenChange, onOpenRoom };
}

describe("the group rooms dialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.rooms = {
      data: { rooms: [ROOM] },
      isLoading: false,
      isError: false,
      refetch: state.listRefetch,
    };
    state.personas = {
      data: READY_PERSONAS,
      isLoading: false,
      isError: false,
      refetch: state.personaRefetch,
    };
    state.creates = [];
    state.deletes = [];
    state.createResult = { id: 42 };
    state.createError = false;
    state.deleteError = false;
    state.confirm.mockResolvedValue(true);
  });

  it("lists the rooms with their member count", () => {
    renderDialog();
    expect(screen.getByText("我们的群")).toBeInTheDocument();
    expect(screen.getByText(new RegExp(translate("zh", "group.memberCount", { count: 2 })))).toBeInTheDocument();
    expect(screen.getByText(/在吗/)).toBeInTheDocument();
  });

  it("says it is still reading rather than that there are no rooms", () => {
    state.rooms = { data: undefined, isLoading: true, isError: false, refetch: state.listRefetch };
    renderDialog();
    expect(screen.getByTestId("group-rooms-list").textContent).toContain(translate("zh", "group.loading"));
    expect(screen.getByTestId("group-rooms-list").textContent).not.toContain(translate("zh", "group.noRooms"));
  });

  it("says the read failed and offers a retry", async () => {
    state.rooms = { data: undefined, isLoading: false, isError: true, refetch: state.listRefetch };
    renderDialog();
    const section = screen.getByTestId("group-rooms-list");
    expect(section.textContent).toContain(translate("zh", "group.loadFailed"));
    await userEvent.click(within(section).getByRole("button", { name: translate("zh", "group.retry") }));
    expect(state.listRefetch).toHaveBeenCalled();
  });

  it("says there are no rooms, not that the read failed", () => {
    state.rooms = { data: { rooms: [] }, isLoading: false, isError: false, refetch: state.listRefetch };
    renderDialog();
    const section = screen.getByTestId("group-rooms-list");
    expect(section.textContent).toContain(translate("zh", "group.noRooms"));
    expect(section.textContent).not.toContain(translate("zh", "group.loadFailed"));
  });

  it("opens a room", async () => {
    const { onOpenRoom } = renderDialog();
    await userEvent.click(screen.getByRole("button", { name: /我们的群/ }));
    expect(onOpenRoom).toHaveBeenCalledWith(7);
  });

  it("only offers analysed personas, and keeps create off until two to five are picked", async () => {
    const user = userEvent.setup();
    state.personas = {
      data: [...READY_PERSONAS, { id: 9, name: "还没分析的", analysisStatus: "analyzing" }],
      isLoading: false,
      isError: false,
      refetch: state.personaRefetch,
    };
    renderDialog();

    const picker = screen.getByTestId("group-persona-picker");
    expect(within(picker).queryByText("还没分析的")).toBeNull();

    const create = screen.getByRole("button", { name: translate("zh", "group.create") });
    expect(create).toBeDisabled();

    await user.click(screen.getByLabelText("小A"));
    expect(create).toBeDisabled();
    await user.click(screen.getByLabelText("小B"));
    expect(create).toBeEnabled();

    await user.click(screen.getByLabelText("小C"));
    await user.click(screen.getByLabelText("小D"));
    await user.click(screen.getByLabelText("小E"));
    expect(create).toBeEnabled();
    await user.click(screen.getByLabelText("小F"));
    expect(create).toBeDisabled();
  });

  it("says when there are too few analysed personas to make a room", () => {
    state.personas = {
      data: [{ id: 1, name: "只有一个", analysisStatus: "ready" }],
      isLoading: false,
      isError: false,
      refetch: state.personaRefetch,
    };
    renderDialog();
    expect(screen.getByText(translate("zh", "group.noEligiblePersonas"))).toBeInTheDocument();
  });

  it("creates a room with the name and the picked personas, and opens it", async () => {
    const user = userEvent.setup();
    const { onOpenChange, onOpenRoom } = renderDialog();

    const nameInput = screen.getByLabelText(translate("zh", "group.roomName"));
    await user.clear(nameInput);
    await user.type(nameInput, "周末的群");
    await user.click(screen.getByLabelText("小A"));
    await user.click(screen.getByLabelText("小C"));
    await user.click(screen.getByRole("button", { name: translate("zh", "group.create") }));

    expect(state.creates).toEqual([{ name: "周末的群", personaIds: [1, 3] }]);
    expect(toastSuccess).toHaveBeenCalledWith(translate("zh", "group.created"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(state.listRefetch).toHaveBeenCalled();
    expect(onOpenRoom).toHaveBeenCalledWith(42);
  });

  it("says a room was not created when the create fails", async () => {
    const user = userEvent.setup();
    state.createError = true;
    renderDialog();
    await user.click(screen.getByLabelText("小A"));
    await user.click(screen.getByLabelText("小B"));
    await user.click(screen.getByRole("button", { name: translate("zh", "group.create") }));
    expect(toastError).toHaveBeenCalledWith(translate("zh", "group.createFailed"));
  });

  it("asks before dissolving a room, and refetches after", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole("button", { name: translate("zh", "group.deleteRoom") }));

    expect(state.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        description: translate("zh", "group.deleteRoomConfirm"),
        destructive: true,
      }),
    );
    expect(state.deletes).toEqual([{ roomId: 7 }]);
    expect(toastSuccess).toHaveBeenCalledWith(translate("zh", "group.deleted"));
    expect(state.listRefetch).toHaveBeenCalled();
  });

  it("does nothing when the dissolve is declined", async () => {
    const user = userEvent.setup();
    state.confirm.mockResolvedValue(false);
    renderDialog();
    await user.click(screen.getByRole("button", { name: translate("zh", "group.deleteRoom") }));
    expect(state.deletes).toEqual([]);
  });

  it("offers a cancel button that closes the dialog", async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog();
    await user.click(screen.getByRole("button", { name: translate("zh", "group.cancel") }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
