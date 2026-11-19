// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

const mutate = vi.fn();
const onArrived = vi.fn();

const pendingState: { data: any; isError: boolean } = {
  data: null,
  isError: false,
};

vi.mock("@/lib/trpc", () => ({
  trpc: {
    chat: {
      pendingReply: {
        useQuery: () => ({
          data: pendingState.data,
          isError: pendingState.isError,
          isLoading: false,
          refetch: vi.fn(),
        }),
      },
      replyNow: {
        useMutation: () => ({ mutate, isPending: false }),
      },
    },
  },
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { timezone: "UTC" } }),
}));

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

import PendingReply from "./PendingReply";

const dueAt = "2024-06-01T12:20:00.000Z";

describe("a pending reply banner", () => {
  beforeEach(() => {
    mutate.mockReset();
    onArrived.mockReset();
    pendingState.data = null;
    pendingState.isError = false;
  });

  it("says nothing when nothing is waiting", () => {
    const { container } = render(
      <PendingReply personaId={5} name="小满" onArrived={onArrived} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("states a delay, a sleep, and a busy window", () => {
    pendingState.data = { jobId: 1, dueAt, reason: "delay" };
    const first = render(<PendingReply personaId={5} name="小满" onArrived={onArrived} />);
    expect(screen.getByText(/按以前的习惯，小满 大约 .+ 回。/)).toBeInTheDocument();
    first.unmount();

    pendingState.data = { jobId: 2, dueAt, reason: "asleep" };
    const second = render(<PendingReply personaId={5} name="小满" onArrived={onArrived} />);
    expect(screen.getByText(/这个点 小满 一般睡了。按记录，小满 通常 .+ 之后回。/)).toBeInTheDocument();
    second.unmount();

    pendingState.data = { jobId: 3, dueAt, reason: "busy", title: "周三下午上课" };
    render(<PendingReply personaId={5} name="小满" onArrived={onArrived} />);
    expect(screen.getByText(/这个时间 小满 一般在周三下午上课，大约 .+ 回。/)).toBeInTheDocument();
  });

  it("asks to write the reply now", async () => {
    pendingState.data = { jobId: 11, dueAt, reason: "delay" };
    const user = userEvent.setup();
    render(<PendingReply personaId={5} name="小满" onArrived={onArrived} />);
    await user.click(screen.getByRole("button", { name: "现在就回" }));
    expect(mutate).toHaveBeenCalledWith({ personaId: 5 });
  });
});
