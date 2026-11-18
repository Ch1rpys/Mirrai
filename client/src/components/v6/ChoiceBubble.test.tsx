// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

const mutate = vi.fn();

vi.mock("@/lib/trpc", () => ({
  trpc: {
    fidelity: {
      choose: {
        useMutation: () => ({ mutate, isPending: false }),
      },
    },
  },
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

import ChoiceBubble from "./ChoiceBubble";

describe("the A/B choice bubble", () => {
  it("puts the two lines side by side and sends the one that was picked", async () => {
    const user = userEvent.setup();
    render(
      <ChoiceBubble
        personaId={5}
        personaName="小A"
        replyToMessageId={7}
        options={["好的呀", "好的。"]}
      />,
    );
    expect(screen.getByText("哪句更像 小A")).toBeInTheDocument();
    expect(screen.getByText("好的呀")).toBeInTheDocument();
    expect(screen.getByText("好的。")).toBeInTheDocument();
    await user.click(screen.getByText("好的呀"));
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        personaId: 5,
        replyToMessageId: 7,
        chosen: "好的呀",
        rejected: "好的。",
      }),
      expect.any(Object),
    );
  });
});
