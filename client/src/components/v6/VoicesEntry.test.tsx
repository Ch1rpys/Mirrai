// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { translate } from "@/i18n";

const navigate = vi.fn();

vi.mock("wouter", () => ({
  useLocation: () => ["/chat/5", navigate],
}));

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

import VoicesEntry from "./VoicesEntry";

describe("the recordings entry (C7.3)", () => {
  it("is in the chat header for a memorial persona", () => {
    render(<VoicesEntry personaId={5} name="小满" memorial />);
    fireEvent.click(screen.getByText(translate("zh", "media.voicesEntry", { name: "小满" })));
    expect(navigate).toHaveBeenCalledWith("/persona/5/voices");
  });

  it("is not there for an ordinary persona", () => {
    const { container } = render(<VoicesEntry personaId={5} name="小满" memorial={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});
