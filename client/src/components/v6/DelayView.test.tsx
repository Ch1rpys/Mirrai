// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { translate } from "@/i18n";

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

import DelayView from "./DelayView";

describe("reply delay on the profile", () => {
  it("shows a median and a count for each part of the day", () => {
    render(
      <DelayView
        name="小满"
        replyDelay={{
          samples: 40,
          resolution: "second",
          buckets: {
            evening: { n: 20, mu: Math.log(40), sigma: 0.8 },
            afternoon: { n: 12, mu: Math.log(120), sigma: 0.8 },
            all: { n: 40, mu: Math.log(50), sigma: 0.8 },
          },
        }}
      />,
    );
    expect(screen.getByText(translate("zh", "profile.delayTitle", { name: "小满" }))).toBeInTheDocument();
    expect(screen.getByText(translate("zh", "profile.delayRow", {
      band: "晚上",
      median: "40 秒",
      n: 20,
    }))).toBeInTheDocument();
    expect(screen.getByText(translate("zh", "profile.delayRow", {
      band: "下午",
      median: "2 分钟",
      n: 12,
    }))).toBeInTheDocument();
    expect(screen.getByText(translate("zh", "profile.delayEmpty", { band: "夜里" }))).toBeInTheDocument();
    expect(screen.getByText(translate("zh", "profile.delayEmpty", { band: "早上" }))).toBeInTheDocument();
  });
});
