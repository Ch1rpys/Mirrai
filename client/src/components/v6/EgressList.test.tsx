// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { translate } from "@/i18n";
import { EGRESS_ITEMS } from "@shared/egress";

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

import EgressList from "./EgressList";

describe("the outbound list", () => {
  it("renders where each connection goes, what it sends, and whether it is on by default", () => {
    render(<EgressList />);
    expect(screen.getByText(translate("zh", "settings.data.egressTitle"))).toBeInTheDocument();
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(EGRESS_ITEMS.length);
    EGRESS_ITEMS.forEach((item, index) => {
      const row = within(rows[index]!);
      expect(row.getByText(item.destination.zh)).toBeInTheDocument();
      expect(row.getByText(item.payload.zh)).toBeInTheDocument();
      expect(
        row.getByText(
          translate("zh", item.defaultOn ? "settings.data.egressOn" : "settings.data.egressOff"),
        ),
      ).toBeInTheDocument();
    });
  });
});
