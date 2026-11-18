// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { translate } from "@/i18n";

vi.mock("@/lib/trpc", () => ({
  trpc: {
    emotion: { getReport: { useQuery: () => ({ data: undefined, isError: false, isLoading: false }) } },
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

import { ChatPeriodHint } from "./Chat";

describe("the period hint on the chat header", () => {
  it("says they are talking to that stretch of them", () => {
    render(<ChatPeriodHint from="2022-01-01" to="2022-06-01" name="小满" />);
    expect(
      screen.getByText("正在和 2022-01-01–2022-06-01 那段时间的 小满 说话。那之后的事，这个 小满 不知道。"),
    ).toBeInTheDocument();
  });
});
