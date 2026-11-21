// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { translate } from "@/i18n";

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

import UndoToast, { UNDO_VISIBLE_MS } from "./UndoToast";

describe("the undo bar", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("says what happened and offers the way back", () => {
    render(<UndoToast onUndo={() => {}} onClose={() => {}} />);
    const bar = screen.getByTestId("undo-toast");
    expect(bar.textContent).toContain(translate("zh", "undo.deleted"));
    expect(bar.textContent).toContain(translate("zh", "undo.undo"));
  });

  it("undoes and closes", async () => {
    const onUndo = vi.fn();
    const onClose = vi.fn();
    render(<UndoToast onUndo={onUndo} onClose={onClose} />);

    await act(async () => {
      screen.getByRole("button", { name: translate("zh", "undo.undo") }).click();
    });

    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes itself after ten seconds", () => {
    const onClose = vi.fn();
    render(<UndoToast onUndo={() => {}} onClose={onClose} />);

    act(() => {
      vi.advanceTimersByTime(UNDO_VISIBLE_MS - 1);
    });
    expect(onClose).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("reports a failed undo and stays up, so it can be tried again", async () => {
    const onUndo = vi.fn().mockRejectedValue(new Error("offline"));
    const onClose = vi.fn();
    render(<UndoToast onUndo={onUndo} onClose={onClose} />);

    await act(async () => {
      screen.getByRole("button", { name: translate("zh", "undo.undo") }).click();
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("undo-toast").textContent).toContain(
      translate("zh", "undo.failed", { message: "offline" }),
    );

    // The bar is still live: the next attempt can go through.
    onUndo.mockResolvedValue(undefined);
    await act(async () => {
      screen.getByRole("button", { name: translate("zh", "undo.undo") }).click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
