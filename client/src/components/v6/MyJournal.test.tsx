// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

/**
 * The user's own diary (C4.5).
 *
 * Write, list, edit, delete. The words are never sent anywhere, and the
 * panel says so next to the box — that sentence is part of the feature,
 * not decoration.
 */
const create = vi.fn();
const update = vi.fn();
const remove = vi.fn();
const invalidate = vi.fn();
let entries: any[] = [];

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ journal: { list: { invalidate } } }),
    journal: {
      list: { useQuery: () => ({ data: { entries }, isLoading: false, isError: false, refetch: vi.fn() }) },
      create: {
        useMutation: (options: any) => ({
          mutate: (input: any) => {
            create(input);
            options?.onSuccess?.();
          },
          isPending: false,
        }),
      },
      update: {
        useMutation: (options: any) => ({
          mutate: (input: any) => {
            update(input);
            options?.onSuccess?.();
          },
          isPending: false,
        }),
      },
      delete: { useMutation: () => ({ mutate: remove, isPending: false }) },
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

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import MyJournal from "./MyJournal";
import { ConfirmProvider } from "@/components/ConfirmDialog";

describe("my own diary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    entries = [];
  });

  it("says where the words stay", () => {
    render(<ConfirmProvider><MyJournal /></ConfirmProvider>);
    expect(screen.getByText(translate("zh", "myJournal.privacyNote"))).toBeInTheDocument();
  });

  it("writes an entry", async () => {
    const user = userEvent.setup();
    render(<ConfirmProvider><MyJournal /></ConfirmProvider>);
    await user.type(screen.getByLabelText(translate("zh", "myJournal.placeholder")), "今天想起第一次见面。");
    await user.click(screen.getByRole("button", { name: translate("zh", "myJournal.save") }));
    expect(create).toHaveBeenCalledWith({ body: "今天想起第一次见面。" });
  });

  it("lists what was written and edits it", async () => {
    const user = userEvent.setup();
    entries = [{ id: 7, entryDate: "2026-03-01", body: "今天很好。" }];
    render(<ConfirmProvider><MyJournal /></ConfirmProvider>);
    expect(screen.getByText("今天很好。")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: translate("zh", "myJournal.edit") }));
    const box = screen.getByDisplayValue("今天很好。");
    await user.clear(box);
    await user.type(box, "今天其实不太好。");
    await user.click(screen.getByRole("button", { name: translate("zh", "microRules.save") }));
    expect(update).toHaveBeenCalledWith({ id: 7, body: "今天其实不太好。" });
  });

  it("deletes only after the app's own confirmation", async () => {
    const user = userEvent.setup();
    entries = [{ id: 7, entryDate: "2026-03-01", body: "今天很好。" }];
    render(<ConfirmProvider><MyJournal /></ConfirmProvider>);
    await user.click(screen.getByRole("button", { name: translate("zh", "myJournal.delete") }));
    await user.click(screen.getByRole("button", { name: translate("zh", "common.confirm") }));
    expect(remove).toHaveBeenCalledWith({ id: 7 });
  });
});
