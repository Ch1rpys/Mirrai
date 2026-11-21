// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { translate } from "@/i18n";

/**
 * The app lock's settings (C8.4).
 *
 * The PIN is set with the account password, the idle window is one to
 * sixty minutes, and turning the lock off takes the PIN and the
 * passkeys with it.
 */

const savePin = vi.fn();
const updateSettings = vi.fn();
const disable = vi.fn();
const removePasskey = vi.fn();
const refetch = vi.fn();
const statusState: { value: any } = { value: undefined };

vi.mock("@/lib/trpc", () => ({
  trpc: {
    lock: {
      status: { useQuery: () => statusState.value },
      setPin: { useMutation: () => ({ mutateAsync: savePin, isPending: false }) },
      updateSettings: { useMutation: () => ({ mutateAsync: updateSettings, isPending: false }) },
      disable: { useMutation: () => ({ mutateAsync: disable, isPending: false }) },
      passkey: {
        registerOptions: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
        registerVerify: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
        remove: { useMutation: () => ({ mutateAsync: removePasskey, isPending: false }) },
      },
    },
  },
}));

vi.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthn: () => false,
  startRegistration: vi.fn(),
}));

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import AppLockSettings from "./AppLockSettings";

function status(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      enabled: true,
      hasPin: true,
      idleMinutes: 5,
      passkeys: [],
      locked: false,
      recentUnlock: false,
      unlockedUntil: null,
      lastUnlockAt: null,
      ...overrides,
    },
    isError: false,
    refetch,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  savePin.mockResolvedValue({ success: true });
  updateSettings.mockResolvedValue({});
  disable.mockResolvedValue({ success: true });
  removePasskey.mockResolvedValue({ success: true });
  refetch.mockResolvedValue({ data: status().data });
});

describe("app lock settings", () => {
  it("sets the first PIN with the account password", async () => {
    statusState.value = status({ hasPin: false });
    render(<AppLockSettings />);

    fireEvent.change(screen.getByLabelText(translate("zh", "appLock.pinLabel")), {
      target: { value: "4821" },
    });
    fireEvent.change(screen.getByLabelText(translate("zh", "appLock.passwordLabel")), {
      target: { value: "correct horse" },
    });
    fireEvent.click(screen.getByRole("button", { name: translate("zh", "appLock.setPinAndEnable") }));

    await waitFor(() =>
      expect(savePin).toHaveBeenCalledWith({ pin: "4821", currentPassword: "correct horse" }),
    );
  });

  it("turns the lock on and off, and saves the idle window", async () => {
    statusState.value = status();
    render(<AppLockSettings />);

    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ enabled: false }));

    const idle = screen.getByLabelText(translate("zh", "appLock.idleLabel"));
    fireEvent.change(idle, { target: { value: "12" } });
    const saveButtons = screen.getAllByRole("button", { name: translate("zh", "appLock.save") });
    fireEvent.click(saveButtons[0]);
    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ idleMinutes: 12 }));
  });

  it("says the browser cannot do passkeys and does not offer the button", () => {
    statusState.value = status({ passkeys: [{ id: "cred-1", label: null, transports: [] }] });
    render(<AppLockSettings />);

    expect(
      screen.getByRole("button", { name: translate("zh", "appLock.passkeyUnsupported") }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: translate("zh", "appLock.removePasskey") }),
    ).toBeInTheDocument();
  });

  it("turns the whole lock off with the account password", async () => {
    statusState.value = status();
    render(<AppLockSettings />);

    const password = screen.getAllByLabelText(translate("zh", "appLock.passwordLabel"));
    fireEvent.change(password[password.length - 1], { target: { value: "correct horse" } });
    const buttons = screen.getAllByRole("button", { name: translate("zh", "appLock.disable") });
    fireEvent.click(buttons[buttons.length - 1]);

    await waitFor(() => expect(disable).toHaveBeenCalledWith({ currentPassword: "correct horse" }));
  });
});
