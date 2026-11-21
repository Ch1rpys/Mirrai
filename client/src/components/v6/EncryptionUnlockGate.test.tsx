// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { translate } from "@/i18n";

/**
 * The screen shown when an encrypted account's data key is not in the
 * server's memory (C8.5).
 *
 * It is raised by the tRPC cache callbacks (`main.tsx`) and dismissed by
 * the account password.
 */

const unlock = vi.fn();
const invalidateQueries = vi.fn();
const refetch = vi.fn();

vi.mock("@/lib/trpc", () => ({
  trpc: {
    encryption: {
      status: { useQuery: () => ({ isLoading: false, isError: false, refetch }) },
      unlock: { useMutation: () => ({ mutateAsync: unlock, isPending: false }) },
    },
  },
}));

vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useQueryClient: () => ({ invalidateQueries }),
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

import {
  encryptionLocked,
  markEncryptionLocked,
  resetEncryptionLockForTests,
} from "@/lib/encryption-lock";
import EncryptionUnlockGate from "./EncryptionUnlockGate";

beforeEach(() => {
  vi.clearAllMocks();
  resetEncryptionLockForTests();
  unlock.mockResolvedValue({ enabled: true, unlocked: true });
});

afterEach(() => {
  resetEncryptionLockForTests();
});

describe("the encryption unlock screen", () => {
  it("stays out of the way while the data is readable", () => {
    render(<EncryptionUnlockGate />);
    expect(screen.queryByText(translate("zh", "encryptionGate.title"))).toBeNull();
  });

  it("asks for the password after a locked answer and dismisses itself", async () => {
    render(<EncryptionUnlockGate />);
    act(() => markEncryptionLocked());
    expect(screen.getByText(translate("zh", "encryptionGate.title"))).toBeTruthy();
    fireEvent.change(screen.getByLabelText(translate("zh", "appLock.passwordLabel")), {
      target: { value: "correct horse" },
    });
    fireEvent.click(screen.getByRole("button", { name: translate("zh", "encryptionGate.unlock") }));
    await waitFor(() => expect(unlock).toHaveBeenCalledWith({ password: "correct horse" }));
    await waitFor(() => expect(encryptionLocked()).toBe(false));
    expect(invalidateQueries).toHaveBeenCalled();
  });
});
