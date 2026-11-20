// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { translate } from "@/i18n";

const dismiss = vi.fn();
const addEvent = vi.fn();
const invalidate = vi.fn();
let summary: any = null;
let summaryError = false;

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ persona: { get: { invalidate } } }),
    persona: {
      reunionSummary: {
        useQuery: () => ({
          data: summary,
          isLoading: false,
          isError: summaryError,
          refetch: vi.fn(),
        }),
      },
      updateSettings: {
        useMutation: (options?: { onSuccess?: () => void }) => ({
          mutate: (input: unknown) => {
            dismiss(input);
            options?.onSuccess?.();
          },
          isPending: false,
        }),
      },
    },
    relationship: {
      add: {
        useMutation: () => ({ mutate: addEvent, isPending: false }),
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

import ReunionSummary from "./ReunionSummary";

const DATA = {
  from: "2026-02-01T00:00:00.000Z",
  to: "2026-03-01T00:00:00.000Z",
  dismissed: false,
  todos: [{ id: 1, body: "一直想说的", createdAt: "2026-02-10T00:00:00.000Z" }],
  unsaid: [],
  letters: [{ id: 2, body: "写了一封信", createdAt: "2026-02-11T00:00:00.000Z" }],
  moods: [{ date: "2026-02-12", mood: "melancholy" }],
  answers: [{ answer: "better", createdAt: "2026-02-13T00:00:00.000Z" }],
};

describe("the summary of a stretch apart (C5.4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    summary = DATA;
    summaryError = false;
  });

  it("shows the blocks that have something in them", () => {
    render(<ReunionSummary personaId={5} name="小满" open onClose={vi.fn()} />);
    expect(screen.getByText("联系上了")).toBeInTheDocument();
    expect(screen.getByText("等 小满 回来再说的事")).toBeInTheDocument();
    expect(screen.getByText("一直想说的")).toBeInTheDocument();
    expect(screen.getByText("写过的信")).toBeInTheDocument();
    expect(screen.getByText("这段时间的心情")).toBeInTheDocument();
    // Nothing was left unsaid, so that block is not there.
    expect(screen.queryByText("想说还没说的话")).toBeNull();
  });

  it("records the day and marks the relationship event", () => {
    render(<ReunionSummary personaId={5} name="小满" open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "记下这一天" }));
    expect(addEvent).toHaveBeenCalledWith(expect.objectContaining({
      personaId: 5,
      kind: "reunion",
      title: "联系上了",
    }));
  });

  it("puts the page away", () => {
    const onClose = vi.fn();
    render(<ReunionSummary personaId={5} name="小满" open onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "收起来" }));
    expect(dismiss).toHaveBeenCalledWith({
      id: 5,
      patch: {
        lastReunion: {
          from: DATA.from,
          to: DATA.to,
          dismissed: true,
        },
      },
    });
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByText("联系上了")).toBeNull();
  });

  it("renders nothing while closed, or when there is no summary", () => {
    const closed = render(
      <ReunionSummary personaId={5} name="小满" open={false} onClose={vi.fn()} />,
    );
    expect(closed.container).toBeEmptyDOMElement();
    closed.unmount();
    summary = null;
    const empty = render(<ReunionSummary personaId={5} name="小满" open onClose={vi.fn()} />);
    expect(empty.queryByText("一直想说的")).toBeNull();
  });

  it("shows a failure with a retry, not an empty summary", () => {
    summaryError = true;
    render(<ReunionSummary personaId={5} name="小满" open onClose={vi.fn()} />);
    expect(screen.getByText(/出了点问题/)).toBeInTheDocument();
  });
});
