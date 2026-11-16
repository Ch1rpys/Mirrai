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

import PersonaSwitches from "./PersonaSwitches";

describe("the persona switches section", () => {
  it("renders the heading and the note", () => {
    render(<PersonaSwitches />);
    expect(screen.getByText("这个分身的开关")).toBeInTheDocument();
    expect(
      screen.getByText("上面一组不多花钱，有记录就会生效。下面一组会多花钱、多等一会儿，或者需要联网，所以默认关着。"),
    ).toBeInTheDocument();
  });
});
