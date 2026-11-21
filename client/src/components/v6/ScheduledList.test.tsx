// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { translate } from "@/i18n";

const cancel = vi.fn();
const refetch = vi.fn();
let items: any[] = [];
let listError = false;
let openBody: string | null = null;

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      scheduled: { list: { invalidate: vi.fn() } },
      letter: {
        inbox: { invalidate: vi.fn() },
        unreadCount: { invalidate: vi.fn() },
      },
    }),
    scheduled: {
      list: {
        useQuery: () => ({
          data: { items },
          isLoading: false,
          isError: listError,
          refetch,
        }),
      },
      cancel: { useMutation: () => ({ mutate: cancel, isPending: false }) },
      markOpened: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      open: {
        useQuery: () => ({
          data: openBody ? { body: openBody, dueAt: "2020-01-01T00:00:00.000Z" } : null,
          isError: false,
          refetch: vi.fn(),
        }),
      },
    },
  },
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { timezone: "Asia/Shanghai" } }),
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
  toast: { success: vi.fn(), error: vi.fn() },
}));

import ScheduledList from "./ScheduledList";

describe("the scheduled things (C5.3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    items = [];
    listError = false;
    openBody = null;
  });

  it("shows a capsule's day but not its words", () => {
    items = [
      { id: 1, kind: "capsule", dueAt: "2099-01-01T00:00:00.000Z", state: "pending", reason: null, body: null },
    ];
    render(<ScheduledList personaId={5} name="小满" />);
    expect(screen.getByText("2099-01-01 才能打开")).toBeInTheDocument();
    expect(screen.queryByText("给以后的自己")).toBeNull();
  });

  it("shows a scheduled message's words and cancels it", () => {
    items = [
      { id: 2, kind: "message", dueAt: "2099-01-01T00:00:00.000Z", state: "pending", reason: null, body: "到那天说一句" },
    ];
    render(<ScheduledList personaId={5} name="小满" />);
    expect(screen.getByText("到那天说一句")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(cancel).toHaveBeenCalledWith({ id: 2 });
  });

  it("opens a capsule once its day has come", () => {
    openBody = "两年前的自己";
    items = [
      { id: 3, kind: "capsule", dueAt: "2020-01-01T00:00:00.000Z", state: "ready", reason: null, body: "两年前的自己" },
    ];
    render(<ScheduledList personaId={5} name="小满" />);
    expect(screen.queryByText("两年前的自己")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "打开" }));
    expect(screen.getByText("两年前的自己")).toBeInTheDocument();
  });

  it("says why something was not sent", () => {
    items = [
      { id: 4, kind: "letter", dueAt: "2020-01-01T00:00:00.000Z", state: "cancelled", reason: "asleep", body: "没送出去" },
    ];
    render(<ScheduledList personaId={5} name="小满" />);
    expect(
      screen.getByText("2020-01-01 那条没有送出去：小满 那时已经休眠了。"),
    ).toBeInTheDocument();
  });

  it("shows a failure with a retry, not an empty list", () => {
    listError = true;
    render(<ScheduledList personaId={5} name="小满" />);
    expect(screen.getByText(/没有读到还没到时间的东西/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(refetch).toHaveBeenCalled();
  });

  it("renders nothing when there is nothing scheduled", () => {
    const { container } = render(<ScheduledList personaId={5} name="小满" />);
    expect(container).toBeEmptyDOMElement();
  });
});
