// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

const inboxState: { value: any } = { value: undefined };
const refetch = vi.fn();
const markRead = vi.fn();
const markOpened = vi.fn();

vi.mock("wouter", () => ({
  useLocation: () => ["/letters", vi.fn()],
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ isAuthenticated: true, user: { id: 1, timezone: "Asia/Shanghai" } }),
}));

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      letter: {
        inbox: { invalidate: vi.fn() },
        unreadCount: { invalidate: vi.fn() },
      },
    }),
    letter: {
      inbox: { useQuery: () => inboxState.value },
      markRead: { useMutation: () => ({ mutate: markRead }) },
    },
    scheduled: {
      markOpened: { useMutation: () => ({ mutate: markOpened }) },
    },
  },
}));

import Letters from "./Letters";

const letter = (overrides: Record<string, unknown>) => ({
  id: 1,
  personaId: 5,
  body: "有些话只能写下来。",
  status: "answered",
  mood: null,
  replyAt: null,
  repliedAt: "2026-03-02T10:00:00.000Z",
  replyText: "我看到了。",
  readAt: null,
  createdAt: "2026-03-01T10:00:00.000Z",
  personaName: "小满",
  ...overrides,
});

describe("the mailbox page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    inboxState.value = {
      data: {
        received: [letter({ id: 1 })],
        waiting: [letter({ id: 2, status: "waiting", replyAt: "2026-03-05T10:00:00.000Z" })],
        kept: [letter({ id: 3, status: "private", body: "只写下来的一封" })],
        capsules: [{
          id: 11,
          personaId: 5,
          kind: "capsule",
          body: "给以后的你",
          dueAt: "2026-01-01T00:00:00.000Z",
          status: "delivered",
          openedAt: null,
          personaName: "小满",
        }],
        upcoming: [{
          id: 12,
          personaId: 5,
          kind: "message",
          body: "到日子再说",
          dueAt: "2099-01-01T00:00:00.000Z",
          status: "scheduled",
          openedAt: null,
          personaName: "小满",
        }],
      },
      isLoading: false,
      isError: false,
      refetch,
    };
  });

  it("renders the five groups with their items", () => {
    render(<Letters />);
    for (const group of [
      "mailbox.received",
      "mailbox.waiting",
      "mailbox.kept",
      "mailbox.capsules",
      "mailbox.upcoming",
    ]) {
      expect(screen.getByText(translate("zh", group as any))).toBeTruthy();
    }
    expect(screen.getByText("我看到了。")).toBeTruthy();
    expect(screen.getByText("只写下来的一封")).toBeTruthy();
    // A due capsule is opened from here, and opening counts as read.
    const openButtons = screen.getAllByText(translate("zh", "mailbox.openCapsule"));
    expect(openButtons).toHaveLength(1);
  });

  it("shows every group's empty state", () => {
    inboxState.value = {
      data: { received: [], waiting: [], kept: [], capsules: [], upcoming: [] },
      isLoading: false,
      isError: false,
      refetch,
    };
    render(<Letters />);
    expect(screen.getByText(translate("zh", "mailbox.empty.received"))).toBeTruthy();
    expect(screen.getByText(translate("zh", "mailbox.empty.waiting"))).toBeTruthy();
    expect(screen.getByText(translate("zh", "mailbox.empty.kept"))).toBeTruthy();
    expect(screen.getByText(translate("zh", "mailbox.empty.capsules"))).toBeTruthy();
    expect(screen.getByText(translate("zh", "mailbox.empty.upcoming"))).toBeTruthy();
  });

  it("offers a retry instead of an empty page when the request failed", async () => {
    inboxState.value = {
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    };
    render(<Letters />);
    expect(screen.getByText(translate("zh", "mailbox.failed"))).toBeTruthy();
    // A failed read is not "you have nothing".
    expect(screen.queryByText(translate("zh", "mailbox.empty.received"))).toBeNull();
    await userEvent.click(screen.getByText(translate("zh", "common.retry")));
    expect(refetch).toHaveBeenCalled();
  });

  it("marks an unread reply read when it is opened, once", async () => {
    render(<Letters />);
    await userEvent.click(screen.getByText("我看到了。"));
    expect(markRead).toHaveBeenCalledWith({ id: 1 });
    // Opening the same one again closes it; it is not marked twice.
    await userEvent.click(screen.getByText("我看到了。"));
    expect(markRead).toHaveBeenCalledTimes(1);
  });

  it("marks a capsule opened when it is opened", async () => {
    render(<Letters />);
    await userEvent.click(screen.getByText(translate("zh", "mailbox.openCapsule")));
    expect(markOpened).toHaveBeenCalledWith({ id: 11 });
    await waitFor(() => expect(screen.getByText("给以后的你")).toBeTruthy());
  });
});
