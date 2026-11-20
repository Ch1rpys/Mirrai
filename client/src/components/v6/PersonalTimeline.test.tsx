// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { translate } from "@/i18n";

/**
 * The four streams on one line (C4.5).
 *
 * The diary, the mood check-ins, the relationship events and the answers
 * after a conversation used to live on four pages in four orders. This is
 * the test that they are one list, in date order, each marked with where
 * it came from.
 */
const journalData = [
  { id: 1, entryDate: "2026-03-03", body: "我写的第三件事" },
];
const moodData = [
  { date: "2026-03-02", mood: "happy", note: "心情打卡第二件事" },
];
const eventData = {
  events: [
    {
      id: 1,
      title: "关系事件第一件事",
      happenedAt: new Date("2026-03-01T10:00:00Z"),
    },
  ],
};
const checkinData = {
  answers: [
    { answer: "worse", createdAt: new Date("2026-03-04T10:00:00Z") },
  ],
};

vi.mock("@/lib/trpc", () => ({
  trpc: {
    journal: { list: { useQuery: () => ({ data: { entries: journalData }, isLoading: false, isError: false }) } },
    user: { moods: { useQuery: () => ({ data: moodData, isLoading: false, isError: false }) } },
    relationship: { list: { useQuery: () => ({ data: eventData, isLoading: false, isError: false }) } },
    checkin: { recent: { useQuery: () => ({ data: checkinData, isLoading: false, isError: false }) } },
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

import PersonalTimeline from "./PersonalTimeline";

describe("the personal timeline", () => {
  it("puts the four kinds in date order, newest first", () => {
    render(<PersonalTimeline personaId={5} />);
    const items = screen.getAllByText(/第一件事|第二件事|第三件事|更难受了/);
    expect(items[0].textContent).toBe("更难受了");
    expect(items[1].textContent).toBe("我写的第三件事");
    expect(items[2].textContent).toBe("心情打卡第二件事");
    expect(items[3].textContent).toBe("关系事件第一件事");
  });

  it("marks each item with the stream it came from", () => {
    const { container } = render(<PersonalTimeline personaId={5} />);
    expect(container.querySelectorAll('[data-timeline-kind="journal"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-timeline-kind="mood"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-timeline-kind="event"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-timeline-kind="checkin"]')).toHaveLength(1);
    expect(screen.getByText(translate("zh", "timeline.journal"))).toBeInTheDocument();
  });
});
