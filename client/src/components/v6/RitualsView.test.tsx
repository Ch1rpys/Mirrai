// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { translate } from "@/i18n";
import RitualsView from "./RitualsView";

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

describe("the ritual table panel", () => {
  it("lists each trigger and how often each reply was used", () => {
    render(
      <RitualsView
        rituals={[
          {
            trigger: "晚安",
            variants: ["晚安"],
            n: 100,
            coverage: 1,
            replies: [
              { text: "晚安", n: 60, recordId: 1 },
              { text: "安", n: 25, recordId: 2 },
              { text: "睡啦", n: 15, recordId: 3 },
            ],
          },
        ]}
      />,
    );
    expect(screen.getByText("固定回法")).toBeInTheDocument();
    const row = screen.getByTestId("ritual-晚安");
    expect(row).toHaveTextContent("晚安");
    expect(row).toHaveTextContent("60");
    expect(row).toHaveTextContent("安");
    expect(row).toHaveTextContent("25");
    expect(row).toHaveTextContent("睡啦");
    expect(row).toHaveTextContent("15");
  });

  it("renders nothing when there is no table", () => {
    const { container } = render(<RitualsView rituals={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
