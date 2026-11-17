// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { translate } from "@/i18n";
import DiscriminatorView from "./DiscriminatorView";

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

describe("the discriminator panel", () => {
  it("renders the AUC and the period tell on the persona side", () => {
    render(
      <DiscriminatorView
        name="小满"
        report={{
          pairs: 200,
          auc: 0.97,
          tells: [
            { feature: "ending.period", weight: -1.4, side: "persona" },
            { feature: "chars", weight: 0.2, side: "real" },
          ],
        }}
      />,
    );
    expect(screen.getByText(/判别器在 200 组真假句上的 AUC 是 0.970/)).toBeInTheDocument();
    expect(screen.getByText("它主要凭这些认出来")).toBeInTheDocument();
    expect(screen.getByText("以句号结尾")).toBeInTheDocument();
    expect(screen.getByText("分身")).toBeInTheDocument();
    expect(screen.getByText(/不是认识 小满 的人/)).toBeInTheDocument();
  });

  it("says so when there were not enough pairs", () => {
    render(
      <DiscriminatorView
        report={{ pairs: 59, auc: 0, tells: [], insufficient: true }}
      />,
    );
    expect(screen.getByText("样本不够（59 / 60）。")).toBeInTheDocument();
    expect(screen.queryByText("它主要凭这些认出来")).toBeNull();
  });

  it("renders nothing when the last run did not train one", () => {
    const { container } = render(<DiscriminatorView report={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
