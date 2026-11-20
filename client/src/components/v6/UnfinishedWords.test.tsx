// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { translate } from "@/i18n";

const complete = vi.fn();
let listState: any;

vi.mock("@/lib/trpc", () => ({
  trpc: {
    unsaid: {
      list: { useQuery: () => listState },
      complete: {
        useMutation: (options?: any) => ({
          mutate: (input: any) => {
            complete(input);
            options?.onSuccess?.({ text: "那下次一起去吧" }, input);
          },
          isPending: false,
          variables: undefined,
        }),
      },
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

import UnfinishedWords from "./UnfinishedWords";

const items = [
  {
    kind: "trailing",
    recordId: 3,
    text: "算了。",
    at: "2024-05-01T21:00:00.000Z",
    context: [
      { recordId: 1, role: "user", text: "周末去看电影吗", at: null },
      { recordId: 2, role: "assistant", text: "好啊 我看看时间", at: null },
    ],
  },
];

describe("the unfinished words block (C6.5)", () => {
  beforeEach(() => {
    complete.mockReset();
    listState = {
      data: { items },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
  });

  it("shows the original line with the two lines before it", () => {
    render(<UnfinishedWords personaId={1} name="小满" />);
    expect(screen.getByText("算了。")).toBeInTheDocument();
    expect(screen.getByText("小满：好啊 我看看时间")).toBeInTheDocument();
    expect(screen.getByText("周末去看电影吗")).toBeInTheDocument();
    expect(
      screen.getByText(translate("zh", "unsaid.complete")),
    ).toBeInTheDocument();
  });

  it("asks for one continuation and labels it as rebuilt", () => {
    render(<UnfinishedWords personaId={1} name="小满" />);
    fireEvent.click(screen.getByText(translate("zh", "unsaid.complete")));
    expect(complete).toHaveBeenCalledWith({ personaId: 1, recordId: 3 });
    expect(
      screen.getByText(translate("zh", "unsaid.reconstructedTitle", { name: "小满" })),
    ).toBeInTheDocument();
    expect(screen.getByText("那下次一起去吧")).toBeInTheDocument();
  });

  it("offers no copy or share control on the reconstructed line", () => {
    render(<UnfinishedWords personaId={1} name="小满" />);
    fireEvent.click(screen.getByText(translate("zh", "unsaid.complete")));
    expect(screen.queryByRole("button", { name: /复制|分享|收进/ })).toBeNull();
  });

  it("does not render when there is nothing unfinished", () => {
    listState = { data: { items: [] }, isLoading: false, isError: false, refetch: vi.fn() };
    const { container } = render(<UnfinishedWords personaId={1} name="小满" />);
    expect(container).toBeEmptyDOMElement();
  });
});
