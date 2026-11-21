// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

const summaryState: { value: any } = { value: undefined };
const configsState: { value: any } = { value: undefined };
const refetch = vi.fn();
const saveBudget = vi.fn();
const savePrice = vi.fn();

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 1, timezone: "Asia/Shanghai" }, isAuthenticated: true }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      usage: {
        summary: { invalidate: vi.fn() },
        budget: { invalidate: vi.fn() },
      },
    }),
    usage: {
      summary: { useQuery: () => summaryState.value },
      setBudget: { useMutation: () => ({ mutate: saveBudget, isPending: false }) },
      setPrice: { useMutation: () => ({ mutate: savePrice, isPending: false }) },
    },
    llmConfig: {
      list: { useQuery: () => configsState.value },
    },
  },
}));

import UsagePanel from "./UsagePanel";

const totals = {
  calls: 4,
  promptTokens: 700,
  completionTokens: 240,
  estimatedCalls: 1,
  costMicros: 3_000_000,
};

function summary(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      range: "month",
      from: "2026-10-31T16:00:00.000Z",
      to: "2026-11-21T00:00:00.000Z",
      totals,
      byPurpose: [
        { purpose: "reply", promptTokens: 600, completionTokens: 200, calls: 3, estimatedCalls: 1, costMicros: 2_000_000 },
        { purpose: "rerank", promptTokens: 100, completionTokens: 40, calls: 1, estimatedCalls: 0, costMicros: 1_000_000 },
      ],
      byPersona: [],
      byDay: [],
      budget: { budget: null, over: false, tokens: 940, costMicros: 3_000_000, monthStart: "" },
      prices: [{ provider: "OpenAI", price: { inputPerMTok: 2, outputPerMTok: 8, currency: "CNY" } }],
      currency: "CNY",
      rerank: { calls: 1, estimatedCalls: 0, costMicros: 1_000_000 },
      lastDistill: {
        at: "2026-11-20T10:00:00.000Z",
        promptTokens: 900,
        completionTokens: 300,
        costMicros: 4_200_000,
        estimated: false,
      },
      ...overrides,
    },
    isLoading: false,
    isError: false,
    refetch,
  };
}

describe("the usage panel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    summaryState.value = summary();
    configsState.value = {
      data: [{ id: 1, providerName: "OpenAI", hasKey: true, extraConfig: {} }],
    };
  });

  it("shows the month's calls and tokens, and the money when a price is set", () => {
    render(<UsagePanel />);
    expect(screen.getByText("用量")).toBeTruthy();
    expect(screen.getByText(/4 次调用/)).toBeTruthy();
    expect(screen.getByText(/940 个 token/)).toBeTruthy();
    // 3,000,000 micros = 3.00 CNY.
    expect(screen.getByText("3.00 CNY")).toBeTruthy();
    // The estimated counts are marked as estimates, not measurements.
    expect(screen.getByText(/1 估算/)).toBeTruthy();
  });

  it("shows tokens only when no price is filled in", () => {
    summaryState.value = summary({
      prices: [],
      currency: null,
      totals: { ...totals, costMicros: 0 },
    });
    render(<UsagePanel />);
    expect(screen.getByText(translate("zh", "usage.noPrice"))).toBeTruthy();
  });

  it("says so when the month is over its budget", () => {
    const base = summary().data;
    summaryState.value = {
      ...summary(),
      data: {
        ...base,
        budget: { ...base.budget, over: true, budget: { monthlyTokens: 500 } },
      },
    };
    render(<UsagePanel />);
    expect(screen.getByText(translate("zh", "usage.overBudget"))).toBeTruthy();
  });

  it("saves the two limits as numbers", async () => {
    render(<UsagePanel />);
    await userEvent.type(screen.getByLabelText(translate("zh", "usage.budgetTokens")), "5000");
    await userEvent.type(screen.getByLabelText(translate("zh", "usage.budgetCost")), "20");
    await userEvent.click(screen.getByText(translate("zh", "usage.budgetSave")));
    expect(saveBudget).toHaveBeenCalledWith({ monthlyTokens: 5000, monthlyCost: 20 });
  });

  it("saves a price for a configured provider", async () => {
    render(<UsagePanel />);
    const input = screen.getByLabelText(translate("zh", "usage.priceInput"));
    const output = screen.getByLabelText(translate("zh", "usage.priceOutput"));
    await userEvent.clear(input);
    await userEvent.type(input, "2");
    await userEvent.clear(output);
    await userEvent.type(output, "8");
    await userEvent.click(screen.getByText(translate("zh", "usage.priceSave")));
    expect(savePrice).toHaveBeenCalledWith({
      provider: "OpenAI",
      inputPerMTok: 2,
      outputPerMTok: 8,
      currency: "CNY",
    });
  });

  it("offers a retry instead of an empty panel when the read failed", async () => {
    summaryState.value = { data: undefined, isLoading: false, isError: true, refetch };
    render(<UsagePanel />);
    expect(screen.getByText(translate("zh", "usage.failed"))).toBeTruthy();
    await userEvent.click(screen.getByText(translate("zh", "common.retry")));
    expect(refetch).toHaveBeenCalled();
  });

  it("says there is nothing yet rather than drawing an empty chart", () => {
    summaryState.value = summary({
      totals: { calls: 0, promptTokens: 0, completionTokens: 0, estimatedCalls: 0, costMicros: 0 },
      byPurpose: [],
      rerank: { calls: 0, estimatedCalls: 0, costMicros: 0 },
      lastDistill: null,
    });
    render(<UsagePanel />);
    expect(screen.getByText(translate("zh", "usage.noData"))).toBeTruthy();
    expect(screen.getByText(translate("zh", "usage.lastDistillNone"))).toBeTruthy();
  });
});
