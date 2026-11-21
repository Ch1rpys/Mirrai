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

import DescribedStatements from "./DescribedStatements";

const statements = [
  {
    text: "生气时先沉默，过一会儿才开口。",
    source: "described" as const,
    quote: "他生气的时候一句话都不说",
    field: "personality" as const,
    teller: "阿树",
  },
  {
    text: "讨厌香菜。",
    source: "described" as const,
    quote: "他讨厌香菜",
    field: "likes" as const,
    teller: "琪琪",
  },
];

describe("the described sentences on the profile (C1.8)", () => {
  it("marks every sentence with where it came from", () => {
    render(
      <DescribedStatements statements={statements} name="小满" ownName="阿树" />,
    );
    const markers = screen.getAllByTestId("described-marker");
    expect(markers).toHaveLength(2);
    // The user's own words say so; a family member is named.
    expect(markers[0]).toHaveTextContent(
      translate("zh", "profile.described"),
    );
    expect(markers[1]).toHaveTextContent(
      translate("zh", "profile.describedBy", { teller: "琪琪" }),
    );
  });

  it("shows the words each sentence was made from", () => {
    render(
      <DescribedStatements statements={statements} name="小满" ownName="阿树" />,
    );
    expect(screen.getByText(/他生气的时候一句话都不说/)).toBeTruthy();
    expect(screen.getByText(/他讨厌香菜/)).toBeTruthy();
    expect(screen.getByText("生气时先沉默，过一会儿才开口。")).toBeTruthy();
    expect(screen.getByText(translate("zh", "profile.describedTitle", { name: "小满" }))).toBeTruthy();
  });

  it("renders nothing when nothing was described", () => {
    const { container } = render(
      <DescribedStatements statements={[]} name="小满" ownName="阿树" />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
