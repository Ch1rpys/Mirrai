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
const fetchOlder = vi.fn();
let createResult: any = {};
let updateResult: any = {};
let entries: any[] = [];
let next: number | null = null;

vi.mock("@/lib/trpc", () => ({
  trpc: {
    safety: {
      resources: { useQuery: () => ({ data: { resources: [] }, isError: false, isLoading: false }) },
    },
    useUtils: () => ({ journal: { list: { invalidate, fetch: fetchOlder } } }),
    journal: {
      list: { useQuery: () => ({ data: { entries, next }, isLoading: false, isError: false, refetch: vi.fn() }) },
      create: {
        useMutation: (options: any) => ({
          mutate: (input: any) => {
            create(input);
            options?.onSuccess?.(createResult);
          },
          isPending: false,
        }),
      },
      update: {
        useMutation: (options: any) => ({
          mutate: (input: any) => {
            update(input);
            options?.onSuccess?.(updateResult);
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
    next = null;
    createResult = {};
    updateResult = {};
  });

  it("shows the crisis card instead of saving a crisis entry (C4.5)", async () => {
    const user = userEvent.setup();
    createResult = { crisis: true };
    render(<ConfirmProvider><MyJournal /></ConfirmProvider>);
    await user.type(screen.getByLabelText(translate("zh", "myJournal.placeholder")), "我不想活了");
    await user.click(screen.getByRole("button", { name: translate("zh", "myJournal.save") }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("shows the crisis card instead of saving a crisis edit (C4.5)", async () => {
    const user = userEvent.setup();
    entries = [{ id: 7, body: "今天", entryDate: "2026-03-01", createdAt: new Date().toISOString() }];
    updateResult = { success: true, crisis: true };
    render(<ConfirmProvider><MyJournal /></ConfirmProvider>);
    await user.click(screen.getByRole("button", { name: translate("zh", "myJournal.edit") }));
    const box = screen.getByDisplayValue("今天");
    await user.clear(box);
    await user.type(box, "我不想活了");
    await user.click(screen.getByRole("button", { name: translate("zh", "microRules.save") }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
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

  it("loads the older entries beyond the first page", async () => {
    entries = Array.from({ length: 30 }, (_, index) => ({
      id: index + 1,
      entryDate: "2026-03-01",
      body: `第 ${index + 1} 篇`,
    }));
    next = 30;
    fetchOlder.mockResolvedValue({
      entries: [{ id: 31, entryDate: "2026-02-01", body: "更早的一篇" }],
      next: null,
    });
    const user = userEvent.setup();
    render(<ConfirmProvider><MyJournal /></ConfirmProvider>);
    await user.click(screen.getByRole("button", { name: translate("zh", "myJournal.loadOlder") }));
    expect(fetchOlder).toHaveBeenCalledWith({ cursor: 30 });
    expect(screen.getByText("更早的一篇")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: translate("zh", "myJournal.loadOlder") })).toBeNull();
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
