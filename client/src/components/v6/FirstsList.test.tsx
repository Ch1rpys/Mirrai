// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

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
      firsts: {
        useQuery: () => ({
          data: [
            { key: "firstLine", recordId: 1, at: "2022-03-01T12:00:00.000Z", text: "在吗", side: "me" },
            { key: "firstGoodnightThem", recordId: 2, at: "2022-03-02T12:00:00.000Z", text: "晚安", side: "them" },
            { key: "lastCall", recordId: 3, at: "2024-10-01T12:00:00.000Z", text: "[call:voice:600]", side: "them" },
          ],
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        }),
      },
    },
  },
}));

import FirstsList from "./FirstsList";

describe("the firsts list", () => {
  it("shows the endings for a persona the hall may feature", () => {
    render(<FirstsList personaId={5} mayFeature />);
    expect(screen.getByText(translate("zh", "report.firsts.firstLine"))).toBeInTheDocument();
    expect(screen.getByText(translate("zh", "report.firsts.lastCall"))).toBeInTheDocument();
  });

  it("folds the endings away until asked", async () => {
    render(<FirstsList personaId={5} mayFeature={false} />);
    expect(screen.queryByText(translate("zh", "report.firsts.lastCall"))).not.toBeInTheDocument();
    expect(screen.getByText(translate("zh", "report.firsts.folded"))).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: translate("zh", "report.firsts.open") }));
    expect(screen.getByText(translate("zh", "report.firsts.lastCall"))).toBeInTheDocument();
  });
});
