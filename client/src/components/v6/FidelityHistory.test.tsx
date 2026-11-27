// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";
import {
  compareColumnsFromVersions,
  historyPointsFromRuns,
  type HistoryRun,
} from "./fidelity-history";

const refetch = vi.fn();

let listState: {
  data: { runs: HistoryRun[] } | undefined;
  isError: boolean;
  refetch: typeof refetch;
} = { data: { runs: [] }, isError: false, refetch };

let versions: Array<{
  id: number;
  reason: string;
  createdAt: string;
  evalRunId: number | null;
}> = [];

vi.mock("@/lib/trpc", () => ({
  trpc: {
    eval: {
      list: {
        useQuery: () => listState,
      },
    },
    personaVersion: {
      list: {
        useQuery: () => ({ data: { versions }, isError: false, refetch: vi.fn() }),
      },
    },
    blind: {
      list: {
        useQuery: () => ({ data: { sessions: [] }, isError: false, refetch: vi.fn() }),
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

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 1, timezone: "Asia/Shanghai" } }),
}));

import FidelityHistory, { FidelityHistoryChart } from "./FidelityHistory";

function runAt(
  id: number,
  iso: string,
  overlap: number,
  extras: Record<string, unknown> = {},
): HistoryRun {
  return {
    id,
    createdAt: iso,
    metricsJson: {
      overlap,
      likelihoodGap: 0.1 * id,
      styleDistance: { total: 0.2 },
      ci: {
        overlap: [overlap - 0.02, overlap + 0.02],
        likelihoodGap: [0, 0.2],
        styleDistance: [0.2, 0.2],
        actMatch: [0, 0],
      },
      discriminator: { auc: 0.7, aucStd: 0.01, pairs: 80, insufficient: false, tells: [] },
      ...extras,
    },
  };
}

describe("the fidelity history curve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listState = { data: { runs: [] }, isError: false, refetch };
    versions = [];
  });

  it("turns three runs into three points", () => {
    const points = historyPointsFromRuns([
      runAt(3, "2026-03-03T00:00:00.000Z", 0.5),
      runAt(1, "2026-03-01T00:00:00.000Z", 0.3),
      runAt(2, "2026-03-02T00:00:00.000Z", 0.4),
    ]);
    expect(points).toHaveLength(3);
    expect(points.map((point) => point.runId)).toEqual([1, 2, 3]);
    expect(points.map((point) => point.overlap.value)).toEqual([0.3, 0.4, 0.5]);
  });

  it("renders three points when given three runs", () => {
    const points = historyPointsFromRuns([
      runAt(1, "2026-03-01T00:00:00.000Z", 0.3),
      runAt(2, "2026-03-02T00:00:00.000Z", 0.4),
      runAt(3, "2026-03-03T00:00:00.000Z", 0.5),
    ]);
    render(<FidelityHistoryChart points={points} versions={[]} />);
    expect(screen.getAllByTestId("fidelity-history-point")).toHaveLength(3);
  });

  it("says how to start when there has never been a run", () => {
    render(<FidelityHistory personaId={1} />);
    expect(screen.getByTestId("fidelity-history-empty")).toBeInTheDocument();
    expect(screen.getByText(translate("zh", "fidelity.historyEmpty"))).toBeInTheDocument();
    expect(screen.getByText(translate("zh", "fidelity.historyHowToStart"))).toBeInTheDocument();
  });

  it("offers a retry when the request failed", async () => {
    listState = { data: undefined, isError: true, refetch };
    const user = userEvent.setup();
    render(<FidelityHistory personaId={1} />);
    expect(screen.getByText(translate("zh", "common.error"))).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: translate("zh", "common.retry") }));
    expect(refetch).toHaveBeenCalled();
  });

  it("shows two columns when there are two persona versions", () => {
    listState = {
      data: {
        runs: [
          runAt(11, "2026-03-01T00:00:00.000Z", 0.3),
          runAt(12, "2026-03-10T00:00:00.000Z", 0.45),
        ],
      },
      isError: false,
      refetch,
    };
    versions = [
      { id: 1, reason: "edit", createdAt: "2026-03-01T00:00:00.000Z", evalRunId: 11 },
      { id: 2, reason: "edit", createdAt: "2026-03-10T00:00:00.000Z", evalRunId: 12 },
    ];
    expect(compareColumnsFromVersions(versions, listState.data!.runs)).toHaveLength(2);
    render(<FidelityHistory personaId={1} />);
    expect(screen.getAllByTestId("fidelity-compare-column")).toHaveLength(2);
  });
});
