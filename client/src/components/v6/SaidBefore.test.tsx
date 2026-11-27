// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

const state: { value: any } = { value: undefined };

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    record: {
      nearest: { useQuery: () => state.value },
    },
  },
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 1, timezone: "Asia/Shanghai" } }),
}));

import SaidBefore from "./SaidBefore";

describe("the 'did they say this' panel", () => {
  beforeEach(() => {
    state.value = { data: undefined, isLoading: false, isError: false };
  });

  it("shows the three verdicts and a dated line for each", async () => {
    state.value = {
      data: [
        {
          text: "晚安",
          verdict: "verbatim",
          matches: [{ id: 11, content: "晚安", at: "2022-03-01T12:00:00.000Z" }],
        },
        {
          text: "好啦 不生气了",
          verdict: "similar",
          matches: [{ id: 12, content: "好啦 不气了", at: "2022-04-01T12:00:00.000Z" }],
        },
        { text: "今天天气不错", verdict: "none", matches: [] },
      ],
      isLoading: false,
      isError: false,
    };
    render(<SaidBefore personaId={5} text={"晚安。好啦 不生气了。今天天气不错"} name="小满" />);
    await userEvent.click(
      screen.getByRole("button", { name: translate("zh", "chat.saidBefore", { name: "小满" }) }),
    );
    expect(screen.getByText(translate("zh", "chat.saidVerbatim"))).toBeInTheDocument();
    expect(screen.getByText(translate("zh", "chat.saidSimilar"))).toBeInTheDocument();
    expect(screen.getByText(translate("zh", "chat.saidNone"))).toBeInTheDocument();
    const links = screen.getAllByText(translate("zh", "chat.saidOpen"));
    expect(links[0].closest("a")?.getAttribute("href")).toBe("/persona/5/records?at=11");
  });

  it("folds a hurtful matching line until it is opened (C10.1)", async () => {
    state.value = {
      data: [{
        text: "你就是个废物",
        verdict: "verbatim",
        matches: [{
          id: 11,
          content: "你就是个废物",
          at: null,
          harmful: true,
        }],
      }],
      isLoading: false,
      isError: false,
    };
    render(<SaidBefore personaId={5} text="你就是个废物" name="小满" />);
    await userEvent.click(
      screen.getByRole("button", { name: translate("zh", "chat.saidBefore", { name: "小满" }) }),
    );
    expect(screen.getByText(translate("zh", "records.folded"))).toBeInTheDocument();
    // Only the sentence being checked is visible; the matching record
    // line itself is still folded.
    expect(screen.getAllByText("你就是个废物")).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: translate("zh", "records.folded") }));
    expect(screen.getAllByText("你就是个废物")).toHaveLength(2);
  });

  it("always says the replica's line is rebuilt", async () => {
    state.value = { data: [], isLoading: false, isError: false };
    render(<SaidBefore personaId={5} text="在吗" name="小满" />);
    await userEvent.click(
      screen.getByRole("button", { name: translate("zh", "chat.saidBefore", { name: "小满" }) }),
    );
    expect(
      screen.getByText(translate("zh", "chat.saidFooter", { name: "小满" })),
    ).toBeInTheDocument();
  });

  it("says the check failed rather than that nothing was said", async () => {
    state.value = { data: undefined, isLoading: false, isError: true };
    render(<SaidBefore personaId={5} text="在吗" name="小满" />);
    await userEvent.click(
      screen.getByRole("button", { name: translate("zh", "chat.saidBefore", { name: "小满" }) }),
    );
    expect(screen.getByText(translate("zh", "chat.saidFailed"))).toBeInTheDocument();
  });
});
