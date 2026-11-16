// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { translate } from "@/i18n";

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

import BackfillBanner from "./BackfillBanner";

describe("the backfill banner", () => {
  it("renders nothing when there is nothing to organise", () => {
    const { container } = render(<BackfillBanner count={0} onBackfill={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the count and the button, and the button runs the pass", () => {
    const onBackfill = vi.fn();
    render(<BackfillBanner count={2} onBackfill={onBackfill} />);
    expect(
      screen.getByText(translate("zh", "upload.backfillBanner", { count: 2 })),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: translate("zh", "upload.backfillNow") }));
    expect(onBackfill).toHaveBeenCalledTimes(1);
  });
});
