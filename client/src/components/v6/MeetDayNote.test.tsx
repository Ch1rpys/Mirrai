// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { translate } from "@/i18n";

const navigate = vi.fn();
let todos: any[] = [];

vi.mock("@/lib/trpc", () => ({
  trpc: {
    letter: {
      todos: {
        useQuery: () => ({ data: { todos, total: todos.length }, isError: false, refetch: vi.fn() }),
      },
    },
  },
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/chat/5", navigate],
}));

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

import MeetDayNote from "./MeetDayNote";

/** Noon in Shanghai, on the day of the meeting. */
const now = new Date("2026-01-15T04:00:00Z");

describe("the meeting-day line (C3.7)", () => {
  it("appears on the day, with the number of unsaid things", () => {
    todos = [
      { id: 1, doneAt: null },
      { id: 2, doneAt: "2026-01-10T00:00:00Z" },
      { id: 3, doneAt: null },
    ];
    render(
      <MeetDayNote
        personaId={5}
        name="小满"
        nextMeetAt="2026-01-15"
        timezone="Asia/Shanghai"
        now={now}
      />,
    );
    expect(screen.getByText("今天见面。有 2 件「等 小满 回来再说」的事 →")).toBeInTheDocument();
  });

  it("does not appear the day before or after", () => {
    todos = [{ id: 1, doneAt: null }];
    const { unmount } = render(
      <MeetDayNote personaId={5} name="小满" nextMeetAt="2026-01-14" timezone="Asia/Shanghai" now={now} />,
    );
    expect(screen.queryByText(/今天见面/)).toBeNull();
    unmount();
    render(
      <MeetDayNote personaId={5} name="小满" nextMeetAt="2026-01-16" timezone="Asia/Shanghai" now={now} />,
    );
    expect(screen.queryByText(/今天见面/)).toBeNull();
  });

  it("reads an instant in the reader's own zone", () => {
    todos = [{ id: 1, doneAt: null }];
    // 2026-01-14T23:00Z is already the 15th in Shanghai, and still the
    // 14th in London.
    render(
      <MeetDayNote personaId={5} name="小满" nextMeetAt="2026-01-14T23:00:00Z" timezone="Asia/Shanghai" now={now} />,
    );
    expect(screen.getByText(/今天见面/)).toBeInTheDocument();
  });

  it("says nothing when there is nothing open or no date", () => {
    todos = [{ id: 1, doneAt: "2026-01-10T00:00:00Z" }];
    const { unmount } = render(
      <MeetDayNote personaId={5} name="小满" nextMeetAt="2026-01-15" timezone="Asia/Shanghai" now={now} />,
    );
    expect(screen.queryByText(/今天见面/)).toBeNull();
    unmount();
    todos = [{ id: 1, doneAt: null }];
    const { container } = render(
      <MeetDayNote personaId={5} name="小满" nextMeetAt={null} timezone="Asia/Shanghai" now={now} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
