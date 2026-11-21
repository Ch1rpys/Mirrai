// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { translate } from "@/i18n";

/**
 * The app lock's screen (C8.4).
 *
 * The server enforces the lock; this checks the interface answers it:
 * the screen appears when a request says `LOCKED`, the two Escape
 * presses lock now, and a correct PIN puts everything back.
 */

const verifyPin = vi.fn();
const verifyPassword = vi.fn();
const lockNow = vi.fn();
const invalidateQueries = vi.fn();
const statusState: { value: any } = { value: undefined };

vi.mock("@/lib/trpc", () => ({
  trpc: {
    lock: {
      status: { useQuery: () => statusState.value },
      verifyPin: { useMutation: () => ({ mutateAsync: verifyPin, isPending: false }) },
      verifyPassword: { useMutation: () => ({ mutateAsync: verifyPassword, isPending: false }) },
      lockNow: { useMutation: () => ({ mutateAsync: lockNow, isPending: false }) },
      passkey: {
        authOptions: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
        authVerify: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      },
    },
    useUtils: () => ({ invalidateQueries }),
  },
}));

vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useQueryClient: () => ({ invalidateQueries }),
}));

vi.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthn: () => false,
  startAuthentication: vi.fn(),
  startRegistration: vi.fn(),
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ isAuthenticated: true }),
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

import AppLock, { LockNowButton } from "./AppLock";
import { markAppLocked, resetAppLockForTests } from "@/lib/app-lock";

beforeEach(() => {
  vi.clearAllMocks();
  resetAppLockForTests();
  verifyPin.mockResolvedValue({ success: true });
  verifyPassword.mockResolvedValue({ success: true });
  lockNow.mockResolvedValue({ locked: true });
  statusState.value = {
    data: {
      enabled: true,
      hasPin: true,
      idleMinutes: 5,
      passkeys: [],
      locked: false,
      recentUnlock: false,
      unlockedUntil: null,
      lastUnlockAt: null,
    },
    isError: false,
  };
});

describe("the lock screen", () => {
  it("appears when the server says the session is locked, and names the page neutrally", async () => {
    render(<AppLock />);
    expect(screen.queryByRole("dialog")).toBeNull();

    act(() => markAppLocked());
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(translate("zh", "lockScreen.title"))).toBeInTheDocument();
    expect(document.title).toBe("Mirrai");
  });

  it("opens everything again with the PIN", async () => {
    render(<AppLock />);
    act(() => markAppLocked());

    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "4821" } });
    fireEvent.click(screen.getByRole("button", { name: translate("zh", "lockScreen.unlock") }));

    await waitFor(() => expect(verifyPin).toHaveBeenCalledWith({ pin: "4821" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(invalidateQueries).toHaveBeenCalled();
  });

  it("asks for the account password when the PIN is forgotten", async () => {
    render(<AppLock />);
    act(() => markAppLocked());

    fireEvent.click(await screen.findByRole("button", { name: translate("zh", "lockScreen.usePassword") }));
    const input = screen.getByLabelText(translate("zh", "lockScreen.passwordLabel"));
    fireEvent.change(input, { target: { value: "correct horse" } });
    fireEvent.click(screen.getByRole("button", { name: translate("zh", "lockScreen.unlock") }));

    await waitFor(() => expect(verifyPassword).toHaveBeenCalledWith({ password: "correct horse" }));
  });
});

describe("locking now", () => {
  it("locks on a double Escape", async () => {
    render(<AppLock />);
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(lockNow).toHaveBeenCalled());
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("puts a button in the top bar only when the lock is on", async () => {
    const { unmount } = render(<LockNowButton />);
    fireEvent.click(await screen.findByRole("button", { name: translate("zh", "lockScreen.lockNow") }));
    await waitFor(() => expect(lockNow).toHaveBeenCalled());
    unmount();

    statusState.value = { data: { ...statusState.value.data, enabled: false }, isError: false };
    render(<LockNowButton />);
    expect(screen.queryByRole("button", { name: translate("zh", "lockScreen.lockNow") })).toBeNull();
  });
});
