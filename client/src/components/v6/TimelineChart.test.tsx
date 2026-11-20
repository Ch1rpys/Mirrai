// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

const confirmMutation = vi.fn();
const rejectMutation = vi.fn();
const annotateMutation = vi.fn();

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
  ReferenceLine: (props: any) => <span data-reference={props.x} />,
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
  beforeEach(() => vi.clearAllMocks());

  it("draws one mark per turning point and says what changed", async () => {
    render(<TimelineChart personaId={5} />);
    const points = document.querySelectorAll("[data-turning-point]");
    expect(points).toHaveLength(2);
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
