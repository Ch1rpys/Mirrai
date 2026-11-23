// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

/**
 * The group-chat switch (C9.8).
 *
 * The switch is the account's flag, not a local one: it reads
 * `auth.me`'s `features.groupChat`, saves through `user.updateFeatures`,
 * says so when the save fails, and never crashes when the field is
 * missing.
 */
const state = vi.hoisted(() => ({
  user: { id: 1, features: { groupChat: false } } as any,
  pending: false,
  calls: [] as Array<{ patch: { groupChat: boolean } }>,
  options: null as any,
  refresh: vi.fn(),
  fail: false,
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: state.user, refresh: state.refresh }),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    user: {
      updateFeatures: {
        useMutation: (options: any) => {
          state.options = options;
          return {
            mutate: (input: { patch: { groupChat: boolean } }) => {
              state.calls.push(input);
              if (state.fail) state.options?.onError?.(new Error("nope"));
              else state.options?.onSuccess?.({ features: { groupChat: input.patch.groupChat } });
            },
            isPending: state.pending,
          };
        },
      },
    },
  },
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

import GroupChatSetting from "./GroupChatSetting";

describe("the group-chat switch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.user = { id: 1, features: { groupChat: false } };
    state.pending = false;
    state.calls = [];
    state.options = null;
    state.fail = false;
  });

  it("draws the section, its notes and the switch", () => {
    render(<GroupChatSetting />);
    expect(screen.getByTestId("group-chat-setting").textContent).toContain(
      translate("zh", "settings.profile.experimentalTitle"),
    );
    expect(screen.getByTestId("group-chat-setting").textContent).toContain(
      translate("zh", "settings.profile.experimentalNote"),
    );
    expect(screen.getByTestId("group-chat-setting").textContent).toContain(
      translate("zh", "settings.profile.groupChatSwitch"),
    );
    expect(screen.getByTestId("group-chat-setting").textContent).toContain(
      translate("zh", "settings.profile.groupChatNote"),
    );
    expect(screen.getByRole("switch")).toBeInTheDocument();
  });

  it("reads the current value from the signed-in user", () => {
    state.user = { id: 1, features: { groupChat: true } };
    render(<GroupChatSetting />);
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });

  it("turns the switch off when the field is missing", () => {
    state.user = { id: 1 };
    render(<GroupChatSetting />);
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  });

  it("saves the next value and says it was saved", async () => {
    const user = userEvent.setup();
    render(<GroupChatSetting />);
    await user.click(screen.getByRole("switch"));
    expect(state.calls).toEqual([{ patch: { groupChat: true } }]);
    expect(toastSuccess).toHaveBeenCalledWith(translate("zh", "settings.profile.groupChatSaved"));
  });

  it("says the setting was not saved when the save fails", async () => {
    const user = userEvent.setup();
    state.fail = true;
    render(<GroupChatSetting />);
    await user.click(screen.getByRole("switch"));
    expect(toastError).toHaveBeenCalledWith(translate("zh", "settings.profile.groupChatFailed"));
  });

  it("is disabled while the save is on its way", () => {
    state.pending = true;
    render(<GroupChatSetting />);
    expect(screen.getByRole("switch")).toBeDisabled();
  });
});
