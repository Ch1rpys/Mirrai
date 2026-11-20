// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { translate } from "@/i18n";

/**
 * Why the app would suggest a goodbye (C4.3).
 *
 * The list is the conditions the check uses; all met iff eligible. No
 * total, no percentage, no progress bar — a relationship is not a
 * progress bar.
 */
const conditions = [
  { key: "intimacy", met: true, detail: "现在：soulmate" },
  { key: "chatCount", met: true, detail: "已经聊了 60 次" },
  { key: "emotionData", met: true, detail: "最近 14 天有 10 次情绪记录" },
  { key: "emotionsRising", met: false, detail: "最近 14 天里，好一点的有 3 次，共 10 次" },
  { key: "frequencyRising", met: true, detail: "最近一周 5 次，前一周 5 次" },
  { key: "checkinsWorse", met: true, detail: "连续更难受：0 次" },
];

vi.mock("@/lib/trpc", () => ({
  trpc: {
    persona: {
      list: { useQuery: () => ({ data: [{ id: 5, name: "小满" }] }) },
      checkGraduation: {
        useQuery: () => ({ data: { eligible: false, conditions }, isLoading: false, isError: false }),
      },
    },
    checkin: {
      recent: {
        useQuery: () => ({
          data: { answers: [{ answer: "worse" }, { answer: "better" }, { answer: "skipped" }] },
        }),
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

import GraduationReasons from "./GraduationReasons";

describe("the graduation reasons", () => {
  it("shows one row per condition the check uses", () => {
    const { container } = render(<GraduationReasons personaId={5} />);
    expect(container.querySelectorAll("li")).toHaveLength(conditions.length);
    expect(screen.getByText(translate("zh", "graduationReasons.condition.intimacy"))).toBeInTheDocument();
    expect(screen.getByText(/还没到/)).toBeInTheDocument();
  });

  it("shows the user's own answers", () => {
    render(<GraduationReasons personaId={5} />);
    expect(screen.getByText("你自己最近的回答")).toBeInTheDocument();
    expect(screen.getByText("更难受了")).toBeInTheDocument();
    expect(screen.getByText("好一点了")).toBeInTheDocument();
    expect(screen.getByText("不想答")).toBeInTheDocument();
  });

  it("has no score, percentage or progress bar", () => {
    const { container } = render(<GraduationReasons personaId={5} />);
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
    expect(container.textContent).not.toContain("%");
    expect(container.textContent).not.toMatch(/得分|评分/);
  });
});
