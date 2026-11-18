// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { translate } from "@/i18n";
import AddressHistoryView from "./AddressHistoryView";

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

describe("AddressHistoryView", () => {
  it("shows both directions by quarter", () => {
    render(
      <AddressHistoryView
        history={[
          {
            form: "树树",
            direction: "them_to_me",
            total: 10,
            byQuarter: { "2022Q1": 4, "2022Q2": 6 },
            byState: { warm: 10 },
          },
          {
            form: "满满",
            direction: "me_to_them",
            total: 8,
            byQuarter: { "2022Q1": 8 },
            byState: {},
          },
        ]}
      />,
    );
    expect(screen.getByText(translate("zh", "profile.address"))).toBeInTheDocument();
    expect(screen.getByText("树树")).toBeInTheDocument();
    expect(screen.getByText("满满")).toBeInTheDocument();
    expect(screen.getAllByText("2022Q1").length).toBeGreaterThan(0);
    expect(screen.getByText("2022Q2")).toBeInTheDocument();
  });
});
