// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { translate } from "@/i18n";

/**
 * The encrypted database's settings (C8.5).
 *
 * Off: two acknowledgements and a password, and no button without a
 * backup. Migrating: the progress, and turning it off is refused. On:
 * lock now, reset the password with the recovery code, and turn it off.
 */

const enable = vi.fn();
const disable = vi.fn();
const unlock = vi.fn();
const lock = vi.fn();
const recover = vi.fn();
const refetch = vi.fn();
const statusState: { value: any } = { value: undefined };

vi.mock("@/lib/trpc", () => ({
  trpc: {
    encryption: {
      status: { useQuery: () => statusState.value },
      enable: { useMutation: () => ({ mutateAsync: enable, isPending: false }) },
      disable: { useMutation: () => ({ mutateAsync: disable, isPending: false }) },
      unlock: { useMutation: () => ({ mutateAsync: unlock, isPending: false }) },
      lock: { useMutation: () => ({ mutateAsync: lock, isPending: false }) },
      recover: { useMutation: () => ({ mutateAsync: recover, isPending: false }) },
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

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import EncryptionSettings from "./EncryptionSettings";

function status(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      enabled: false,
      unlocked: false,
      hasRecoveryCode: false,
      hasFullBackup: true,
      migrating: false,
      migration: null,
      migratedAt: null,
      ...overrides,
    },
    isError: false,
    isLoading: false,
    refetch,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  enable.mockResolvedValue({
    recoveryCode: "ABCD-EFGH-JKLM-NPQR-STUV-WXYZ",
    enabled: true,
    migrating: true,
  });
  disable.mockResolvedValue({});
  unlock.mockResolvedValue({});
  lock.mockResolvedValue({});
  recover.mockResolvedValue({});
  refetch.mockResolvedValue(status());
});

describe("encrypted storage settings", () => {
  it("asks for a backup before encryption can be turned on", () => {
    statusState.value = status({ hasFullBackup: false });
    render(<EncryptionSettings />);
    expect(screen.getByText(translate("zh", "encryption.backupNeeded"))).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: translate("zh", "encryption.enable") }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("needs both acknowledgements and the password", async () => {
    statusState.value = status();
    render(<EncryptionSettings />);
    fireEvent.change(screen.getByLabelText(translate("zh", "encryption.passwordLabel")), {
      target: { value: "correct horse" },
    });
    const button = screen.getByRole("button", {
      name: translate("zh", "encryption.enable"),
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(translate("zh", "encryption.understandLost")));
    expect(button.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(translate("zh", "encryption.understandRestart")));
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() =>
      expect(enable).toHaveBeenCalledWith({
        password: "correct horse",
        lostContentUnderstood: true,
        restartUnderstood: true,
      }),
    );
  });

  it("shows the recovery code once, after enabling", async () => {
    statusState.value = status();
    render(<EncryptionSettings />);
    fireEvent.change(screen.getByLabelText(translate("zh", "encryption.passwordLabel")), {
      target: { value: "correct horse" },
    });
    fireEvent.click(screen.getByLabelText(translate("zh", "encryption.understandLost")));
    fireEvent.click(screen.getByLabelText(translate("zh", "encryption.understandRestart")));
    fireEvent.click(screen.getByRole("button", { name: translate("zh", "encryption.enable") }));
    expect(await screen.findByText("ABCD-EFGH-JKLM-NPQR-STUV-WXYZ")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: translate("zh", "encryption.recoveryDone") }));
    expect(screen.queryByText("ABCD-EFGH-JKLM-NPQR-STUV-WXYZ")).toBeNull();
  });

  it("shows the progress of a running job and refuses to turn it off", () => {
    statusState.value = status({
      enabled: true,
      unlocked: true,
      hasRecoveryCode: true,
      migrating: true,
      migration: { direction: "encrypt", done: 500, total: 2000 },
    });
    render(<EncryptionSettings />);
    expect(screen.getByText(translate("zh", "encryption.progress", { done: 500, total: 2000 }))).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: translate("zh", "encryption.disable") }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("locks the session again and turns encryption off", async () => {
    statusState.value = status({
      enabled: true,
      unlocked: true,
      hasRecoveryCode: true,
    });
    render(<EncryptionSettings />);
    fireEvent.click(screen.getByRole("button", { name: translate("zh", "encryption.lockNow") }));
    await waitFor(() => expect(lock).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText(translate("zh", "encryption.passwordLabel")), {
      target: { value: "correct horse" },
    });
    fireEvent.click(screen.getByRole("button", { name: translate("zh", "encryption.disable") }));
    await waitFor(() => expect(disable).toHaveBeenCalledWith({ password: "correct horse" }));
  });

  it("resets the password with the recovery code", async () => {
    statusState.value = status({
      enabled: true,
      unlocked: false,
      hasRecoveryCode: true,
    });
    render(<EncryptionSettings />);
    fireEvent.change(screen.getByLabelText(translate("zh", "encryption.recoveryCodeLabel")), {
      target: { value: "ABCD-EFGH-JKLM-NPQR-STUV-WXYZ" },
    });
    fireEvent.change(screen.getByLabelText(translate("zh", "encryption.newPasswordLabel")), {
      target: { value: "a new password" },
    });
    fireEvent.click(screen.getByRole("button", { name: translate("zh", "encryption.resetPassword") }));
    await waitFor(() =>
      expect(recover).toHaveBeenCalledWith({
        recoveryCode: "ABCD-EFGH-JKLM-NPQR-STUV-WXYZ",
        newPassword: "a new password",
      }),
    );
  });
});
