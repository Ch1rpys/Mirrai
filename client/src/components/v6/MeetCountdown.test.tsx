// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { translate } from "@/i18n";

const updateSettings = vi.fn();
const addEvent = vi.fn();

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ persona: { get: { invalidate: vi.fn() } } }),
    persona: {
      updateSettings: {
        useMutation: (options?: { onSuccess?: () => void }) => ({
          mutate: (input: unknown) => {
            updateSettings(input);
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

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

import MeetCountdown from "./MeetCountdown";

/** Noon in Shanghai on 1 March 2026. */
const now = new Date("2026-03-01T04:00:00Z");

describe("the meeting countdown (C5.1)", () => {
  it("counts the days before the meeting", () => {
    render(
      <MeetCountdown personaId={5} nextMeetAt="2026-03-04" timezone="Asia/Shanghai" now={now} />,
    );
    expect(screen.getByText("还有 3 天见面（2026-03-04）")).toBeInTheDocument();
  });

  it("keeps a short countdown in the header on a narrow screen (C5.1)", () => {
    // The line was `hidden sm:inline`: on a phone the countdown simply
    // did not exist, and the manual asks the header to show it.
    render(
      <MeetCountdown personaId={5} nextMeetAt="2026-03-04" timezone="Asia/Shanghai" now={now} />,
    );
    expect(screen.getByText("3 天后见面")).toBeInTheDocument();
  });

  it("says you meet today on the day", () => {
    render(
      <MeetCountdown personaId={5} nextMeetAt="2026-03-01" timezone="Asia/Shanghai" now={now} />,
    );
    expect(screen.getByText("今天见面")).toBeInTheDocument();
  });

  it("says nothing without a date, or after the day, in the inline line", () => {
    const { container, unmount } = render(
      <MeetCountdown personaId={5} nextMeetAt={null} timezone="Asia/Shanghai" now={now} />,
    );
    expect(container).toBeEmptyDOMElement();
    unmount();
    render(
      <MeetCountdown personaId={5} nextMeetAt="2026-02-01" timezone="Asia/Shanghai" now={now} />,
    );
    expect(screen.queryByText(/见面/)).toBeNull();
  });

  it("asks whether you met, once, after the day", () => {
    render(
      <MeetCountdown
        personaId={5}
        nextMeetAt="2026-02-01"
        timezone="Asia/Shanghai"
        now={now}
        mode="banner"
      />,
    );
    expect(screen.getByText("2026-02-01 那天，见到了吗？")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "见到了" }));
    expect(updateSettings).toHaveBeenCalledWith({
      id: 5,
      patch: { ldr: { nextMeetAt: null } },
    });
    expect(addEvent).toHaveBeenCalledWith({
      personaId: 5,
      kind: "meetup",
      title: "见到了",
      happenedAt: "2026-02-01",
    });
    expect(screen.queryByText(/见到了吗/)).toBeNull();
  });

  it("stops asking after any of the other two answers", () => {
    render(
      <MeetCountdown
        personaId={5}
        nextMeetAt="2026-02-01"
        timezone="Asia/Shanghai"
        now={now}
        mode="banner"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "不提了" }));
    expect(updateSettings).toHaveBeenCalledWith({
      id: 5,
      patch: { ldr: { nextMeetAt: null } },
    });
    expect(screen.queryByText(/见到了吗/)).toBeNull();
  });

  it("takes a new date when the meeting moved", () => {
    render(
      <MeetCountdown
        personaId={5}
        nextMeetAt="2026-02-01"
        timezone="Asia/Shanghai"
        now={now}
        mode="banner"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "改期了" }));
    fireEvent.change(screen.getByLabelText("新的日子"), { target: { value: "2026-04-01" } });
    fireEvent.click(screen.getByRole("button", { name: "就这天" }));
    expect(updateSettings).toHaveBeenCalledWith({
      id: 5,
      patch: { ldr: { nextMeetAt: "2026-04-01" } },
    });
    expect(screen.queryByText(/见到了吗/)).toBeNull();
  });
});
