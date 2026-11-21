// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { translate } from "@/i18n";

const budgetState: { value: any } = { value: undefined };

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
    usage: { budget: { useQuery: () => budgetState.value } },
  },
}));

import BudgetNotice from "./BudgetNotice";

describe("the budget notice", () => {
  beforeEach(() => {
    budgetState.value = { data: { over: false } };
  });

  it("stays out of the way while there is budget left", () => {
    render(<BudgetNotice />);
    expect(screen.queryByTestId("budget-notice")).toBeNull();
  });

  it("says the month is over its ceiling", () => {
    budgetState.value = { data: { over: true } };
    render(<BudgetNotice />);
    expect(screen.getByTestId("budget-notice").textContent).toBe(
      translate("zh", "usage.overBudget"),
    );
  });

  it("says nothing when the read failed rather than claiming a budget", () => {
    budgetState.value = { data: undefined, isError: true };
    render(<BudgetNotice />);
    expect(screen.queryByTestId("budget-notice")).toBeNull();
  });
});
