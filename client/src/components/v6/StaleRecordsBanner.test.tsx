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

import StaleRecordsBanner from "./StaleRecordsBanner";

describe("the stale-records banner", () => {
  it("renders nothing when nothing was added", () => {
    const { container } = render(<StaleRecordsBanner added={0} onRebuild={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the count and the button, and the button starts a rebuild", () => {
    const onRebuild = vi.fn();
    render(<StaleRecordsBanner added={8} onRebuild={onRebuild} />);
    expect(
      screen.getByText(translate("zh", "upload.staleRecordsBanner", { added: 8 })),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: translate("zh", "upload.staleRecordsNow") }));
    expect(onRebuild).toHaveBeenCalledTimes(1);
  });
});
