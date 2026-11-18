// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { translate } from "@/i18n";
import { MIN_FINGERPRINT_SAMPLES } from "@shared/style-fingerprint";
import { buildMaterialReport } from "@shared/material-report";
import { MaterialReportView } from "./MaterialReport";

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

describe("the material report", () => {
  it("says how far short a thin fingerprint is", () => {
    const report = buildMaterialReport({
      total: 30,
      theirs: 15,
      mine: 15,
      others: 0,
      from: null,
      to: null,
      withTimestamps: 30,
      byKind: { text: 30 },
      byEmotion: {
        warm: 30,
        playful: 30,
        nostalgic: 30,
        melancholy: 30,
        happy: 30,
        distant: 6,
      },
      theirsText: 15,
      theirsLabeledAct: 0,
      timedExchanges: 0,
      openings: 0,
      periodHave: 0,
    });
    render(<MaterialReportView report={report} />);
    const short = MIN_FINGERPRINT_SAMPLES - 15;
    expect(screen.getByTestId("material-layer-fingerprint")).toHaveTextContent(
      translate("zh", "material.short", { n: short }),
    );
    expect(screen.getByTestId("material-layer-perState")).toHaveTextContent(
      "TA 处于「疏离」时的话只有 6 条，还看不出规律。",
    );
  });
});
