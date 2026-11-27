// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { translate } from "@/i18n";

/**
 * The wellbeing trend (C4.3).
 *
 * Four series and four statements. The app states what it counted; it
 * does not grade it.
 */
let state: any = { data: null, isLoading: false, isError: false, refetch: vi.fn() };

vi.mock("@/lib/trpc", () => ({
  trpc: { analytics: { wellbeing: { get: { useQuery: () => state } } } },
}));

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

import WellbeingTrends from "./WellbeingTrends";

const weeks = Array.from({ length: 8 }, (_, index) => ({
  start: `2026-01-0${index + 1}`,
  end: `2026-01-0${index + 1}`,
  moods: index,
  checkins: { better: index, same: 0, worse: 1 },
  visits: index,
  lateNight: index % 2,
  messages: index * 3,
}));

const data = {
  weeks,
  recent: { moods: 22, checkins: { better: 4, same: 2, worse: 1 }, visits: 18, lateNight: 3, messages: 50 },
  previous: { moods: 10, checkins: { better: 1, same: 1, worse: 4 }, visits: 9, lateNight: 5, messages: 40 },
};

describe("the wellbeing trend", () => {
  it("states the four comparisons, not a score", () => {
    state = { data, isLoading: false, isError: false, refetch: vi.fn() };
    render(<WellbeingTrends />);
    expect(screen.getByText("最近的你")).toBeInTheDocument();
    expect(screen.getByText(/最近四周心情打卡 22 次，之前四周是 10 次/)).toBeInTheDocument();
    expect(screen.getByText(/好一点 4 次、差不多 2 次、更难受 1 次/)).toBeInTheDocument();
    // The after-chat answers were the one series with no previous four
    // weeks to compare against — the manual asks all four to compare.
    expect(screen.getByText(/之前四周分别是 1 次、1 次、4 次/)).toBeInTheDocument();
    expect(screen.getByText(/最近四周你来了 18 天，之前四周是 9 天/)).toBeInTheDocument();
    expect(screen.getByText(/最近四周，深夜 0–5 点来的有 3 条，占 50 条；之前四周是 5 条，占 40 条/)).toBeInTheDocument();
  });

  it("has four curves and no score or progress bar", () => {
    state = { data, isLoading: false, isError: false, refetch: vi.fn() };
    const { container } = render(<WellbeingTrends />);
    expect(container.querySelectorAll("svg")).toHaveLength(4);
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
    expect(container.textContent).not.toContain("%");
    expect(container.textContent).not.toMatch(/得分|评分/);
  });

  it("does not render a failure as an empty trend", () => {
    state = { data: null, isLoading: false, isError: true, refetch: vi.fn() };
    render(<WellbeingTrends />);
    expect(screen.getByText(translate("zh", "common.error"))).toBeInTheDocument();
    expect(screen.queryByText("最近的你")).toBeNull();
  });
});
