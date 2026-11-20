// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

const list = vi.fn();

vi.mock("@/lib/trpc", () => ({
  trpc: {
    outbound: {
      list: { useQuery: (...a: unknown[]) => list(...a) },
    },
  },
}));

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

import OutboundEntry from "./OutboundEntry";

describe("the way-out door in the chat menu", () => {
  it("carries the number of sentences waiting", () => {
    list.mockReturnValue({ data: { letters: [{ id: 1 }, { id: 2 }] } });
    render(<OutboundEntry personaId={5} name="小满" onOpen={() => {}} />);
    expect(screen.getByRole("button", { name: "想对 小满 说的话（2）" })).toBeInTheDocument();
  });

  it("says it in memorial mode's words", () => {
    list.mockReturnValue({ data: { letters: [] } });
    render(<OutboundEntry personaId={5} name="小满" memorial onOpen={() => {}} />);
    expect(
      screen.getByRole("button", { name: "想对 小满 说、但来不及说的话（0）" }),
    ).toBeInTheDocument();
  });

  it("opens the drawer", async () => {
    const onOpen = vi.fn();
    list.mockReturnValue({ data: { letters: [] } });
    const user = userEvent.setup();
    render(<OutboundEntry personaId={5} name="小满" onOpen={onOpen} />);
    await user.click(screen.getByRole("button"));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
