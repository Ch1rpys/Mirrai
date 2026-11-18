// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { translate } from "@/i18n";
import TriggersView from "./TriggersView";

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

describe("the trigger table", () => {
  it("expands a row to show the original line and its date", () => {
    render(
      <TriggersView
        name="小满"
        timeZone="Asia/Shanghai"
        triggers={[
          {
            userAct: "acknowledge",
            to: "distant",
            n: 6,
            examples: [
              { recordId: 11, text: "嗯", at: "2022-03-12T04:00:00.000Z" },
              { recordId: 12, text: "哦", at: "2022-03-11T16:30:00.000Z" },
            ],
          },
        ]}
      />,
    );
    expect(screen.getByText("这些话之后，小满 通常会不高兴")).toBeInTheDocument();
    fireEvent.click(screen.getByText(/记录里有 6 次/));
    expect(screen.getByText("嗯")).toBeInTheDocument();
    expect(screen.getByText("哦")).toBeInTheDocument();
    // 16:30Z is 00:30 the next day in Shanghai, the same calendar day as noon.
    expect(screen.getAllByText("2022-03-12")).toHaveLength(2);
  });

  it("renders nothing when there is no table", () => {
    const { container } = render(<TriggersView name="小满" triggers={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
