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

import CallsView from "./CallsView";

const calls = {
  samples: 20,
  byDirection: { in: 14, out: 6, missed: 0 },
  durationSec: { median: 1800, p90: 3000, total: 36000 },
  perWeekMedian: 1,
  answerSlots: [
    { weekday: 0, hour: 21, n: 16 },
    { weekday: 3, hour: 20, n: 2 },
  ],
  longest: { recordId: 9, durationSec: 3600, at: "2024-06-02T13:00:00.000Z" },
  first: { recordId: 1, at: "2022-03-06T13:00:00.000Z" },
  last: { recordId: 20, at: "2024-09-29T13:00:00.000Z" },
};

describe("the calls on the profile", () => {
  it("states who called, how long, and when they answer", () => {
    render(<CallsView name="小满" calls={calls} />);
    expect(screen.getByText(translate("zh", "profile.callsTitle", { name: "小满" }))).toBeInTheDocument();
    expect(
      screen.getByText(
        translate("zh", "profile.callsWho", { name: "小满", incoming: 14, outgoing: 6, missed: 0 }),
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(translate("zh", "profile.callsDuration", { median: 30, longest: 60 })),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        translate("zh", "profile.callsWhen", {
          slots: [
            translate("zh", "profile.callsSlot", { weekday: "周日", hour: 21 }),
            translate("zh", "profile.callsSlot", { weekday: "周三", hour: 20 }),
          ].join(translate("zh", "profile.callsJoin")),
        }),
      ),
    ).toBeInTheDocument();
  });

  it("renders nothing when there is no measurement", () => {
    const { container } = render(<CallsView name="小满" calls={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
