// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

const listState: { value: any } = { value: {} };
const activateMutate = vi.fn();
const deactivateMutate = vi.fn();
const createMutate = vi.fn();
const updateMutate = vi.fn();
const duplicateMutate = vi.fn();
const removeMutate = vi.fn();
const invalidate = vi.fn();
const confirm = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

vi.mock("@/components/ConfirmDialog", () => ({
  useConfirm: () => confirm,
}));

vi.mock("sonner", () => ({
  toast: {
    success: (text: string) => toastSuccess(text),
    error: (text: string) => toastError(text),
  },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ scene: { list: { invalidate } } }),
    scene: {
      list: { useQuery: () => listState.value },
      activate: {
        useMutation: (options: any) => ({ mutate: activateMutate, isPending: false, options }),
      },
      deactivate: {
        useMutation: (options: any) => ({ mutate: deactivateMutate, isPending: false, options }),
      },
      create: {
        useMutation: (options: any) => ({ mutate: createMutate, isPending: false, options }),
      },
      update: {
        useMutation: (options: any) => ({ mutate: updateMutate, isPending: false, options }),
      },
      duplicate: {
        useMutation: (options: any) => ({ mutate: duplicateMutate, isPending: false, options }),
      },
      delete: {
        useMutation: (options: any) => ({ mutate: removeMutate, isPending: false, options }),
      },
    },
  },
}));

import ScenePanel from "./ScenePanel";

const builtin = {
  id: 3,
  name: "深夜聊天",
  description: "夜深人静",
  icon: "🌙",
  systemPromptOverlay: "现在是深夜。",
  emotionalState: "nostalgic",
  starters: ["睡不着吗？"],
  isBuiltin: true,
  recordRange: null,
};

const own = {
  id: 4,
  name: "一起做饭",
  description: "厨房里",
  icon: "🍳",
  systemPromptOverlay: "你们在厨房里。",
  emotionalState: "playful",
  starters: ["今天做什么？"],
  isBuiltin: false,
  recordRange: null,
};

function renderPanel() {
  return render(
    <ScenePanel
      personaId={5}
      activeSceneId={null}
      onClose={vi.fn()}
      onPersonaChanged={vi.fn()}
    />,
  );
}

describe("the scene panel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listState.value = {
      data: [builtin, own],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
    confirm.mockResolvedValue(true);
  });

  it("says it is still reading rather than that there are no scenes", () => {
    listState.value = { data: undefined, isLoading: true, isError: false, refetch: vi.fn() };
    renderPanel();
    const panel = screen.getByTestId("scene-panel");
    expect(panel.textContent).toContain(translate("zh", "sceneForm.loading"));
    expect(panel.textContent).not.toContain(translate("zh", "sceneForm.empty"));
  });

  it("reports a failed read and offers to try again", async () => {
    const refetch = vi.fn();
    listState.value = { data: undefined, isLoading: false, isError: true, refetch };
    renderPanel();
    expect(screen.getByTestId("scene-panel").textContent).toContain(
      translate("zh", "sceneForm.loadFailed"),
    );
    await userEvent.click(screen.getByRole("button", { name: translate("zh", "sceneForm.retry") }));
    expect(refetch).toHaveBeenCalled();
  });

  it("says there are no scenes — not that the read failed", () => {
    listState.value = { data: [], isLoading: false, isError: false, refetch: vi.fn() };
    renderPanel();
    const panel = screen.getByTestId("scene-panel");
    expect(panel.textContent).toContain(translate("zh", "sceneForm.empty"));
    expect(panel.textContent).not.toContain(translate("zh", "sceneForm.loadFailed"));
  });

  it("lets a built-in scene be copied, but not edited in place", () => {
    renderPanel();
    expect(
      screen.getByRole("button", {
        name: `${translate("zh", "sceneForm.duplicate")} 深夜聊天`,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: `${translate("zh", "sceneForm.edit")} 深夜聊天`,
      }),
    ).toBeNull();
    expect(screen.getByText(translate("zh", "sceneForm.builtin"))).toBeInTheDocument();

    // A scene of the user's own has all three actions.
    expect(
      screen.getByRole("button", { name: `${translate("zh", "sceneForm.edit")} 一起做饭` }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: `${translate("zh", "sceneForm.delete")} 一起做饭` }),
    ).toBeInTheDocument();
  });

  it("marks a scene that was cut from a stretch of the record (C8.13)", () => {
    // The badge is the only way a person can tell a range scene from a
    // hand-written one; the progress row claimed it was tested.
    listState.value = {
      data: [{
        ...own,
        id: 21,
        name: "那一周",
        recordRange: { personaId: 5, fromId: 10, toId: 20, from: "2022-03-01", to: "2022-03-07" },
      }],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
    renderPanel();
    expect(screen.getByText(translate("zh", "sceneForm.rangeBadge"))).toBeInTheDocument();
  });

  it("copies a built-in scene", async () => {
    renderPanel();
    await userEvent.click(
      screen.getByRole("button", { name: `${translate("zh", "sceneForm.duplicate")} 深夜聊天` }),
    );
    expect(duplicateMutate).toHaveBeenCalledWith({ id: 3 });
  });

  it("edits a scene of the user's own through the same form", async () => {
    renderPanel();
    await userEvent.click(
      screen.getByRole("button", { name: `${translate("zh", "sceneForm.edit")} 一起做饭` }),
    );

    expect(screen.getByText(translate("zh", "sceneForm.editTitle"))).toBeInTheDocument();
    const nameInput = screen.getByPlaceholderText(translate("zh", "sceneForm.namePlaceholder"));
    expect(nameInput).toHaveValue("一起做饭");

    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "一起做饭吧");
    await userEvent.click(screen.getByRole("button", { name: translate("zh", "sceneForm.save") }));

    await waitFor(() => expect(updateMutate).toHaveBeenCalled());
    expect(updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 4, name: "一起做饭吧" }),
    );
  });

  it("makes a new scene through the same form", async () => {
    renderPanel();
    await userEvent.click(screen.getByRole("button", { name: translate("zh", "sceneForm.title") }));
    await userEvent.type(
      screen.getByPlaceholderText(translate("zh", "sceneForm.namePlaceholder")),
      "周末散步",
    );
    await userEvent.click(screen.getByRole("button", { name: translate("zh", "sceneForm.create") }));

    await waitFor(() => expect(createMutate).toHaveBeenCalled());
    expect(createMutate).toHaveBeenCalledWith(expect.objectContaining({ name: "周末散步" }));
  });

  it("deletes a scene of the user's own after asking", async () => {
    renderPanel();
    await userEvent.click(
      screen.getByRole("button", { name: `${translate("zh", "sceneForm.delete")} 一起做饭` }),
    );
    await waitFor(() => expect(removeMutate).toHaveBeenCalledWith({ id: 4 }));
  });

  it("activates a scene on the persona", async () => {
    renderPanel();
    await userEvent.click(screen.getByText("深夜聊天"));
    expect(activateMutate).toHaveBeenCalledWith({ personaId: 5, sceneId: 3 });
  });
});
