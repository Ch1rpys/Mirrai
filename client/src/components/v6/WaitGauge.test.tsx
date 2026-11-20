// @vitest-environment jsdom
import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { translate } from "@/i18n";

/**
 * The waiting gauge (C3.1).
 *
 * It says what the past looks like and nothing else. There is no clock
 * in it: no countdown, no "you have been waiting N minutes", no
 * notification — the structural test at the bottom of this file is the
 * one that keeps it that way.
 */
let styleState: { data: any; isLoading: boolean; isError: boolean } = {
  data: { profile: null },
  isLoading: false,
  isError: false,
};

vi.mock("@/lib/trpc", () => ({
  trpc: {
    style: {
      get: {
        useQuery: () => ({
          ...styleState,
          refetch: vi.fn(),
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

import WaitGauge from "./WaitGauge";

const evening = { n: 40, mu: Math.log(40), sigma: 0.8 };

const profile = {
  replyDelay: {
    samples: 120,
    resolution: "second",
    buckets: {
      evening,
      morning: { n: 30, mu: Math.log(30), sigma: 0.7 },
      afternoon: { n: 5, mu: Math.log(120), sigma: 0.8 },
      all: { n: 120, mu: Math.log(45), sigma: 0.8 },
    },
  },
};

/** 21:00 in Shanghai. */
const atNine = new Date("2026-01-15T13:00:00Z");

describe("the waiting gauge", () => {
  beforeEach(() => {
    styleState = { data: { profile }, isLoading: false, isError: false };
  });

  it("states the median and the ninetieth percentile for this hour", () => {
    render(<WaitGauge personaId={5} name="小满" timezone="Asia/Shanghai" now={atNine} />);
    expect(screen.getByText(/一半在 40 秒 之内，九成在 2 分钟 之内/)).toBeInTheDocument();
  });

  it("shows a row per part of the day, and says when a row is too thin", () => {
    render(<WaitGauge personaId={5} name="小满" timezone="Asia/Shanghai" now={atNine} />);
    expect(screen.getByText("晚上")).toBeInTheDocument();
    expect(screen.getByText("晚上", { selector: "th" }).nextElementSibling).toHaveTextContent("一半 40 秒 之内");
    // The afternoon bucket has five gaps; it is not a measurement.
    const afternoon = screen.getByText("下午", { selector: "th" });
    expect(afternoon.nextElementSibling).toHaveTextContent("记录太少");
    // Night has no bucket at all, so it is thin too.
    expect(screen.getAllByText("记录太少")).toHaveLength(2);
  });

  it("always carries the note that this is not a promise", () => {
    render(<WaitGauge personaId={5} name="小满" timezone="Asia/Shanghai" now={atNine} />);
    expect(screen.getByText(/这是过去的统计，不是保证/)).toBeInTheDocument();
  });

  it("says when there is not enough record to measure", () => {
    styleState = { data: { profile: null }, isLoading: false, isError: false };
    render(<WaitGauge personaId={5} name="小满" now={atNine} />);
    expect(screen.getByText(translate("zh", "waitGauge.empty"))).toBeInTheDocument();
    expect(screen.queryByText(/这是过去的统计/)).toBeNull();
  });

  it("does not render a failure as 'nothing here'", () => {
    styleState = { data: undefined, isLoading: false, isError: true };
    render(<WaitGauge personaId={5} name="小满" now={atNine} />);
    expect(screen.getByText(translate("zh", "common.error"))).toBeInTheDocument();
    expect(screen.queryByText(translate("zh", "waitGauge.empty"))).toBeNull();
  });

  it("has no clock in it at all", () => {
    const source = readFileSync(path.resolve(__dirname, "WaitGauge.tsx"), "utf8");
    expect(source).not.toMatch(/setInterval|setTimeout|Notification/);
  });
});
