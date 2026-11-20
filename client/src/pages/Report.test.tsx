// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

const reportState: { value: any } = { value: undefined };
const refetch = vi.fn();

vi.mock("wouter", () => ({
  useParams: () => ({ id: "5" }),
  useLocation: () => ["/persona/5/report", vi.fn()],
}));

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
  BarChart: ({ children }: any) => <div>{children}</div>,
  LineChart: ({ children }: any) => <div>{children}</div>,
  Bar: () => null,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
  ReferenceLine: () => null,
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      record: { timeline: { invalidate: vi.fn() } },
    }),
    persona: {
      get: { useQuery: () => ({ data: { id: 5, name: "小满", analysisStatus: "ready" }, isLoading: false }) },
    },
    record: {
      report: { useQuery: () => reportState.value },
      timeline: { useQuery: () => ({ data: { series: [], points: [] }, isLoading: false, isError: false, refetch }) },
      firsts: { useQuery: () => ({ data: [], isLoading: false, isError: false, refetch }) },
      places: { useQuery: () => ({ data: { places: [], tileUrl: null }, isLoading: false, isError: false, refetch }) },
      songs: { useQuery: () => ({ data: [], isLoading: false, isError: false, refetch }) },
    },
    turningPoint: {
      confirm: { useMutation: () => ({ mutate: vi.fn() }) },
      reject: { useMutation: () => ({ mutate: vi.fn() }) },
      annotate: { useMutation: () => ({ mutate: vi.fn() }) },
    },
  },
}));

import Report from "./Report";

const report = {
  span: { from: "2022-03-01", to: "2024-10-31", days: 975, activeDays: 160 },
  totals: { me: 2, them: 3, byKind: { text: { me: 2, them: 3 } } },
  byMonth: [{ month: "2022-03", me: 2, them: 3 }],
  byYear: [{
    year: 2022,
    me: 2,
    them: 3,
    charsMe: 20,
    charsThem: 30,
    startsMe: 1,
    startsThem: 2,
    goodnightFirstMe: 1,
    goodnightFirstThem: 0,
    replyMedianSecMe: 10,
    replyMedianSecThem: 20,
    topTerms: ["咕咕"],
  }],
  longestScene: { fromId: 11, from: "2022-03-01T20:00:00.000Z", minutes: 30, count: 20 },
  longestSilence: { from: "2023-06-10T00:00:00.000Z", to: "2023-07-04T00:00:00.000Z", days: 25 },
  heatmap: Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0)),
  calls: null,
};

describe("the report page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reportState.value = { data: { status: "ready", report }, isLoading: false, isError: false, refetch };
  });

  it("has the five tabs and opens on the yearly numbers", () => {
    render(<Report />);
    for (const key of ["annual", "timeline", "firsts", "places", "songs"] as const) {
      expect(
        screen.getByRole("tab", { name: translate("zh", `report.tabs.${key}` as any) }),
      ).toBeInTheDocument();
    }
    expect(screen.getByText(translate("zh", "report.monthlyTitle"))).toBeInTheDocument();
    expect(screen.getByText(/咕咕/)).toBeInTheDocument();
  });

  it("shows each tab's own content", async () => {
    const user = userEvent.setup();
    render(<Report />);
    await user.click(screen.getByRole("tab", { name: translate("zh", "report.tabs.timeline") }));
    expect(screen.getByText(translate("zh", "report.timelineEmpty"))).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: translate("zh", "report.tabs.firsts") }));
    expect(screen.getByText(translate("zh", "report.empty"))).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: translate("zh", "report.tabs.places") }));
    expect(screen.getByText(translate("zh", "report.places.empty"))).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: translate("zh", "report.tabs.songs") }));
    expect(screen.getByText(translate("zh", "report.songs.empty"))).toBeInTheDocument();
  });

  it("says the record is empty instead of drawing empty axes", () => {
    reportState.value = {
      data: {
        status: "ready",
        report: { ...report, totals: { me: 0, them: 0, byKind: {} }, byMonth: [], byYear: [] },
      },
      isLoading: false,
      isError: false,
      refetch,
    };
    render(<Report />);
    expect(screen.getByText(translate("zh", "report.empty"))).toBeInTheDocument();
  });

  it("offers a retry when the count failed", async () => {
    reportState.value = { data: undefined, isLoading: false, isError: true, refetch };
    render(<Report />);
    expect(screen.getByText(translate("zh", "report.failed"))).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: translate("zh", "report.retry") }));
    expect(refetch).toHaveBeenCalled();
  });

  it("says it is still counting a very large record", () => {
    reportState.value = {
      data: { status: "building" },
      isLoading: false,
      isError: false,
      refetch,
    };
    render(<Report />);
    expect(screen.getByText(translate("zh", "report.building"))).toBeInTheDocument();
  });
});
