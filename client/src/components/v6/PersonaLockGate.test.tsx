// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { translate } from "@/i18n";

/**
 * The chat page's gate for a locked persona (C8.4).
 *
 * A persona lock is not the app lock: the rest of the app is readable,
 * and the page asks for the PIN instead of offering a retry button that
 * could never work.
 */

const verifyPin = vi.fn();
const invalidate = vi.fn();

vi.mock("@/lib/trpc", () => ({
  trpc: {
    lock: {
      verifyPin: { useMutation: () => ({ mutateAsync: verifyPin, isPending: false }) },
    },
    useUtils: () => ({ invalidate }),
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

import PersonaLockGate from "./PersonaLockGate";

beforeEach(() => {
  vi.clearAllMocks();
  verifyPin.mockResolvedValue({ success: true });
});

describe("the persona lock gate", () => {
  it("asks for the PIN and tells the page to come back after it", async () => {
    const onUnlocked = vi.fn();
    render(<PersonaLockGate onUnlocked={onUnlocked} />);

    expect(screen.getByText(translate("zh", "personaUnlock.title"))).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "4821" } });
    fireEvent.click(screen.getByRole("button", { name: translate("zh", "lockScreen.unlock") }));

    await waitFor(() => expect(verifyPin).toHaveBeenCalledWith({ pin: "4821" }));
    await waitFor(() => expect(onUnlocked).toHaveBeenCalled());
    expect(invalidate).toHaveBeenCalled();
  });
});
