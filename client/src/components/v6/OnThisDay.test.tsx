// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

const state: { value: any; input?: { personaId: number } } = { value: undefined };

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    record: {
      onThisDay: {
        useQuery: (input: { personaId: number }) => {
          state.input = input;
          return state.value;
        },
      },
    },
  },
}));

import OnThisDay from "./OnThisDay";

const years = [
  {
    year: 2022,
    date: "2022-03-01",
    rows: [{ id: 11, role: "assistant", content: "在的呀", timestamp: "2022-03-01T12:00:00.000Z" }],
  },
];

const featured = {
  id: 5,
  name: "小满",
  analysisStatus: "ready",
  graduationStatus: null,
  presence: "active",
  reachability: "reachable",
  relationshipEnded: false,
  settings: { onThisDay: true },
};

describe("on this day in the hall", () => {
  beforeEach(() => {
    state.value = { data: years };
    state.input = undefined;
  });

  it("shows the year and the real line for a persona the hall may feature", () => {
    render(<OnThisDay personas={[featured]} />);
    expect(screen.getByText(translate("zh", "records.onThisDayTitle"))).toBeInTheDocument();
    expect(screen.getByText("2022 年的今天")).toBeInTheDocument();
    expect(screen.getByText(/在的呀/)).toBeInTheDocument();
    expect(screen.getByText(translate("zh", "records.onThisDayOpen")).closest("a")?.getAttribute("href"))
      .toBe("/persona/5/records?at=11");
  });

  it("keeps it folded for a persona the hall may not feature, until asked", async () => {
    render(<OnThisDay personas={[{ ...featured, presence: "quiet" }]} />);
    expect(screen.queryByText("2022 年的今天")).not.toBeInTheDocument();
    expect(screen.getByText(translate("zh", "records.onThisDayCollapsed", { n: 1 }))).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: translate("zh", "records.onThisDaySee") }));
    expect(screen.getByText("2022 年的今天")).toBeInTheDocument();
  });

  it("renders nothing when there is no earlier record", () => {
    state.value = { data: [] };
    const { container } = render(<OnThisDay personas={[featured]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the setting is off", () => {
    const { container } = render(
      <OnThisDay personas={[{ ...featured, settings: { onThisDay: false } }]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("never falls back to a locked persona (C8.4)", () => {
    /**
     * A locked persona is a card with no name; it is not a candidate
     * for "on this day" either. The fallback used to be `personas[0]`,
     * so an account whose personas were all locked still read records
     * for the hidden one — and the read is refused with `LOCKED`, which
     * opens the app lock screen from the hall.
     */
    const locked = {
      ...featured,
      settings: { locked: true, onThisDay: true },
      locked: true,
    };
    const first = render(<OnThisDay personas={[locked]} />);
    expect(first.container).toBeEmptyDOMElement();
    expect(state.input?.personaId ?? 0).toBe(0);
    first.unmount();

    // With somebody else in the list, the other persona is looked at.
    const paused = { ...featured, id: 6, name: "暂停的", presence: "quiet" };
    render(<OnThisDay personas={[locked, paused]} />);
    expect(state.input?.personaId).toBe(6);
  });
});
