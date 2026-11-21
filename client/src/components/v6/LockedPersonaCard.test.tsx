// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { translate } from "@/i18n";

/**
 * A locked persona in the lobby (C8.4).
 *
 * The card carries no name and no face — the server sends neither — and
 * its only action is the PIN, which refreshes the lobby on success.
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

import LockedPersonaCard from "./LockedPersonaCard";

beforeEach(() => {
  vi.clearAllMocks();
  verifyPin.mockResolvedValue({ success: true });
});

describe("a locked persona's card", () => {
  it("shows no name, and its only action is unlocking", () => {
    render(<LockedPersonaCard personaId={5} />);
    expect(screen.getByText(translate("zh", "lobby.card.locked"))).toBeInTheDocument();
    expect(screen.queryByText("小满")).toBeNull();
    expect(screen.getByRole("button", { name: translate("zh", "lobby.card.unlock") })).toBeInTheDocument();
  });

  it("unlocks with the PIN and refreshes what is on screen", async () => {
    render(<LockedPersonaCard personaId={5} />);
    fireEvent.click(screen.getByRole("button", { name: translate("zh", "lobby.card.unlock") }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "4821" } });
    fireEvent.click(within(dialog).getByRole("button", { name: translate("zh", "lockScreen.unlock") }));

    await waitFor(() => expect(verifyPin).toHaveBeenCalledWith({ pin: "4821" }));
    await waitFor(() => expect(invalidate).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
