// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { translate } from "@/i18n";

const addOwn = vi.fn();
let letters: any[] = [];

vi.mock("@/lib/trpc", () => ({
  trpc: {
    outbound: {
      list: { useQuery: () => ({ data: { letters }, isLoading: false }) },
      addOwn: {
        useMutation: (options?: any) => {
          const mutate = (input: any) => {
            addOwn(input);
            options?.onSuccess?.();
          };
          return { mutate, isPending: false };
        },
      },
    },
    useUtils: () => ({ outbound: { list: { invalidate: vi.fn() } } }),
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

import MutualLetters from "./MutualLetters";

describe("the two letters (C6.5)", () => {
  beforeEach(() => {
    addOwn.mockReset();
    letters = [];
  });

  it("puts the persona's letter and the user's letter side by side", () => {
    render(<MutualLetters personaId={1} name="小满" theirLetter="我一直都知道，只是没说。" />);
    expect(screen.getByText("我一直都知道，只是没说。")).toBeInTheDocument();
    expect(
      screen.getByText(translate("zh", "mutualLetters.theirLabel", { name: "小满" })),
    ).toBeInTheDocument();
    expect(screen.getByText(translate("zh", "mutualLetters.yourLabel"))).toBeInTheDocument();
  });

  it("writes a letter on the spot when there is nothing to pick", () => {
    render(<MutualLetters personaId={1} name="小满" theirLetter="嗯。" />);
    const box = screen.getByPlaceholderText(
      translate("zh", "mutualLetters.placeholder", { name: "小满" }),
    );
    fireEvent.change(box, { target: { value: "我也想你了" } });
    fireEvent.click(screen.getByText(translate("zh", "mutualLetters.save")));
    expect(addOwn).toHaveBeenCalledWith({ personaId: 1, text: "我也想你了" });
    expect(screen.getByText("我也想你了")).toBeInTheDocument();
  });

  it("reads a letter from the exit list", () => {
    letters = [
      { id: 7, text: "那天的雨很大。" },
      { id: 8, text: "谢谢你陪我走这一段。" },
    ];
    render(<MutualLetters personaId={1} name="小满" theirLetter="嗯。" />);
    fireEvent.change(
      screen.getByLabelText(translate("zh", "mutualLetters.pick")),
      { target: { value: "8" } },
    );
    expect(screen.getAllByText("谢谢你陪我走这一段。")).toHaveLength(2);
  });
});
