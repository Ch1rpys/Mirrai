// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
    for (const item of EGRESS_ITEMS) {
      expect(screen.getAllByText(item.destination.zh).length).toBeGreaterThan(0);
      expect(screen.getAllByText(item.payload.zh).length).toBeGreaterThan(0);
    }
    const onCount = EGRESS_ITEMS.filter((item) => item.defaultOn).length;
    const offCount = EGRESS_ITEMS.length - onCount;
    expect(screen.getAllByText(translate("zh", "settings.data.egressOn"))).toHaveLength(onCount);
    expect(screen.getAllByText(translate("zh", "settings.data.egressOff"))).toHaveLength(offCount);
  });
});
