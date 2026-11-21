// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { translate } from "@/i18n";

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

import DescribedFidelityNote from "./DescribedFidelityNote";

describe("the fidelity note for a described persona (C1.8)", () => {
  it("says there are no original words to compare against", () => {
    render(<DescribedFidelityNote name="小满" />);
    expect(screen.getByTestId("fidelity-described")).toHaveTextContent(
      "这个分身是按你的描述写的，没有 小满 的原话可以对照，所以量不出像不像。",
    );
    expect(screen.getByTestId("fidelity-described")).toHaveTextContent(
      translate("zh", "fidelity.described", { name: "小满" }),
    );
  });
});
