// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { translate } from "@/i18n";
import { measureFingerprint } from "@shared/style-fingerprint";
import { buildXiaomanRecords } from "../../../../server/test-fixtures/xiaoman";
import FingerprintView from "./FingerprintView";

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

describe("the fingerprint panel", () => {
  it("renders the rare-period line of the fixture", () => {
    const fingerprint = measureFingerprint(
      buildXiaomanRecords().map((row) => ({
        role: row.role,
        content: row.content,
        timestamp: row.timestamp,
        kind: row.kind,
        emotion: row.truth.state,
      })),
      { addressForms: ["陈树", "树树"] },
    );
    render(<FingerprintView fingerprint={fingerprint} />);
    expect(screen.getByText(/几乎不以句号结尾/)).toBeInTheDocument();
  });

  it("does not render a claim that does not have a clear majority", () => {
    const fingerprint = measureFingerprint(
      Array.from({ length: 40 }, (_, i) => ({
        role: "assistant",
        content: i % 2 === 0 ? "好的。" : "行。",
        kind: "text",
      })),
    );
    const { container } = render(<FingerprintView fingerprint={fingerprint} />);
    expect(screen.queryByText(/几乎不以句号结尾/)).toBeNull();
    expect(screen.queryByText(translate("zh", "fidelity.fingerprint.laughFourHa"))).toBeNull();
    expect(container.querySelector("li")).toBeNull();
  });
});
