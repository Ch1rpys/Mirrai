// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

vi.mock("@/components/OutboundLetters", () => ({
  default: ({ personaId }: { personaId: number }) => (
    <div data-testid="outbound-letters">letters for {personaId}</div>
  ),
}));

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

import OutboundDrawer from "./OutboundDrawer";

describe("the way-out drawer", () => {
  it("shows the same list the farewell page shows", () => {
    render(<OutboundDrawer personaId={5} name="小满" open onClose={() => {}} />);
    expect(screen.getByRole("dialog", { name: "想对 小满 说的话" })).toBeInTheDocument();
    expect(screen.getByTestId("outbound-letters")).toHaveTextContent("letters for 5");
  });

  it("can be closed", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<OutboundDrawer personaId={5} name="小满" open onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: translate("zh", "common.close") }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders nothing while it is closed", () => {
    const { container } = render(
      <OutboundDrawer personaId={5} name="小满" open={false} onClose={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
