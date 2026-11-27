// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

const mockState = vi.hoisted(() => ({ extraEvent: false }));
const confirmMutation = vi.fn();
const rejectMutation = vi.fn();
const annotateMutation = vi.fn();

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { timezone: "Asia/Shanghai" } }),
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
  LineChart: ({ children }: any) => <div>{children}</div>,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  ReferenceLine: (props: any) => (
    <span
      data-reference={props.x}
      data-clickable={props.onClick ? "yes" : undefined}
      onClick={props.onClick}
    />
  ),
}));

const series = Array.from({ length: 20 }, (_, index) => ({
  week: `2023-W${String(index + 1).padStart(2, "0")}`,
  total: 10,
  myShare: 0.5,
  replyMedianSec: 40,
  charsMedian: index < 10 ? 10 : 6,
  startsMeShare: 0.5,
  negativeShare: 0,
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ record: { timeline: { invalidate: vi.fn() } } }),
    record: {
      timeline: {
        useQuery: () => ({
          data: {
            series,
            points: [
              { id: "2023-W10", at: "2023-W10", changes: [{ series: "charsMedian", before: 10, after: 6 }], status: "auto" },
              { id: "2023-W14", at: "2023-W14", changes: [{ series: "myShare", before: 0.5, after: 0.3 }], status: "auto" },
            ],
            events: [
              { at: "2023-03-06T12:00:00.000Z", week: "2023-W10", kind: "meetup", title: "第一次见面" },
              ...(mockState.extraEvent
                ? [{ at: "2024-05-31T20:30:00.000Z", week: "2024-W22", kind: "news", title: "深夜那条消息" }]
                : []),
            ],
          },
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        }),
      },
    },
    turningPoint: {
      confirm: { useMutation: () => ({ mutate: confirmMutation }) },
      reject: { useMutation: () => ({ mutate: rejectMutation }) },
      annotate: { useMutation: () => ({ mutate: annotateMutation }) },
    },
  },
}));

import TimelineChart from "./TimelineChart";

describe("the timeline chart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.extraEvent = false;
  });

  it("puts a relationship event on the reader's day, not the UTC one (C4.6)", () => {
    // 04:30 on the 1st in Shanghai is still the 31st in Greenwich. The
    // event list sliced the instant, so every event between midnight and
    // eight in the morning showed the day before.
    mockState.extraEvent = true;
    render(<TimelineChart personaId={5} />);
    expect(screen.getByText("2024-06-01")).toBeInTheDocument();
    expect(screen.queryByText("2024-05-31")).toBeNull();
  });

  it("draws one mark per turning point and says what changed", async () => {
    render(<TimelineChart personaId={5} />);
    const points = document.querySelectorAll("[data-turning-point]");
    expect(points).toHaveLength(2);
    // Two turning-point lines (one chart each) and one event line in
    // each of the six charts.
    expect(document.querySelectorAll("[data-reference]")).toHaveLength(8);
    expect(screen.getByText(/第一次见面/)).toBeInTheDocument();
    await userEvent.click(screen.getByText("2023-W10"));
    expect(
      screen.getByText(
        translate("zh", "report.change", {
          series: translate("zh", "report.series.charsMedian"),
          before: 10,
          after: 6,
        }),
      ),
    ).toBeInTheDocument();
  });

  it("selects the turn when its vertical line is clicked", async () => {
    render(<TimelineChart personaId={5} />);
    const line = document.querySelector('[data-reference="2023-W10"][data-clickable="yes"]');
    expect(line).toBeTruthy();
    fireEvent.click(line!);
    expect(
      screen.getByText(
        translate("zh", "report.change", {
          series: translate("zh", "report.series.charsMedian"),
          before: 10,
          after: 6,
        }),
      ),
    ).toBeInTheDocument();
  });

  it("keeps a turn, and rejects one without a note", async () => {
    render(<TimelineChart personaId={5} />);
    await userEvent.click(screen.getByText("2023-W10"));
    await userEvent.click(screen.getByRole("button", { name: translate("zh", "report.confirm") }));
    expect(confirmMutation).toHaveBeenCalledWith({
      personaId: 5,
      id: "2023-W10",
      note: undefined,
    });

    await userEvent.click(screen.getByText("2023-W14"));
    await userEvent.click(screen.getByRole("button", { name: translate("zh", "report.reject") }));
    expect(rejectMutation).toHaveBeenCalledWith({ personaId: 5, id: "2023-W14" });
  });

});
