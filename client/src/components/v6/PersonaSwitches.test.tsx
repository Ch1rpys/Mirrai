// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

const mutate = vi.fn();

vi.mock("@/lib/trpc", () => ({
  trpc: {
    persona: {
      getSettings: {
        useQuery: () => ({
          data: { layers: { abPairs: false } },
          isLoading: false,
          refetch: vi.fn(),
        }),
      },
      updateSettings: {
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

import PersonaSwitches from "./PersonaSwitches";

describe("the persona switches section", () => {
  it("renders the heading, the free length cap, and the costly A/B switch", () => {
    render(<PersonaSwitches personaId={5} name="小满" />);
    expect(screen.getByText("这个分身的开关")).toBeInTheDocument();
    expect(
      screen.getByText("上面一组不多花钱，有记录就会生效。下面一组会多花钱、多等一会儿，或者需要联网，所以默认关着。"),
    ).toBeInTheDocument();
    expect(screen.getByText("开口前先看几句 小满 的原话")).toBeInTheDocument();
    expect(screen.getByText("「晚安」「在吗」这类话，直接用 小满 的原话回")).toBeInTheDocument();
    expect(screen.getByText("聊久了也别跑偏")).toBeInTheDocument();
    expect(screen.getByText("不让它写得比 小满 长")).toBeInTheDocument();
    expect(screen.getByText("按 小满 的标点习惯收尾")).toBeInTheDocument();
    expect(screen.getByText("做同一件事时，照 小满 做过的样子")).toBeInTheDocument();
    expect(screen.getByText("小满 的情绪按 小满 的节奏变")).toBeInTheDocument();
    expect(screen.getByText("小满 会自己说「我先睡了」")).toBeInTheDocument();
    expect(screen.getByText("分身提到往事时，标出记录里有没有")).toBeInTheDocument();
    expect(screen.getByText("偶尔让我二选一")).toBeInTheDocument();
    expect(screen.getByText("先想好说什么，再用 小满 的话说")).toBeInTheDocument();
    expect(screen.getByText("提到了记录里没有的往事，就让它重说")).toBeInTheDocument();
  });

  it("turns the A/B pair on", async () => {
    const user = userEvent.setup();
    render(<PersonaSwitches personaId={5} name="小满" />);
    await user.click(screen.getByRole("checkbox", { name: /偶尔让我二选一/ }));
    expect(mutate).toHaveBeenCalledWith({
      id: 5,
      patch: { layers: { abPairs: true } },
    });
  });

  it("turns two-stage generation on", async () => {
    const user = userEvent.setup();
    render(<PersonaSwitches personaId={5} name="小满" />);
    await user.click(screen.getByRole("checkbox", { name: /先想好说什么，再用 小满 的话说/ }));
    expect(mutate).toHaveBeenCalledWith({
      id: 5,
      patch: { layers: { twoStage: true } },
    });
  });

  it("turns fact annotation off", async () => {
    const user = userEvent.setup();
    render(<PersonaSwitches personaId={5} name="小满" />);
    await user.click(screen.getByRole("checkbox", { name: /分身提到往事时，标出记录里有没有/ }));
    expect(mutate).toHaveBeenCalledWith({
      id: 5,
      patch: { layers: { factAnnotate: false } },
    });
  });

  it("turns fact rewrite on", async () => {
    const user = userEvent.setup();
    render(<PersonaSwitches personaId={5} name="小满" />);
    await user.click(screen.getByRole("checkbox", { name: /提到了记录里没有的往事，就让它重说/ }));
    expect(mutate).toHaveBeenCalledWith({
      id: 5,
      patch: { layers: { factRewrite: true } },
    });
  });
});
