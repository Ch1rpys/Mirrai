// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { translate } from "@/i18n";

const save = vi.fn();
const onDone = vi.fn();
const results = [
  { id: 1, content: "晚安呀", timestamp: "2024-05-01T21:00:00.000Z" },
  { id: 2, content: "喜欢你", timestamp: "2024-04-01T21:00:00.000Z" },
  { id: 3, content: "早点睡", timestamp: "2024-03-01T21:00:00.000Z" },
];
const bookmarks = [
  {
    id: 9,
    recordId: 9,
    kind: "bookmark",
    content: "书签里的一句",
    timestamp: "2024-02-01T21:00:00.000Z",
  },
];

vi.mock("@/lib/trpc", () => ({
  trpc: {
    persona: {
      getSettings: {
        useQuery: () => ({
          data: { keptQuotes: [] },
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        }),
      },
      setKeptQuotes: {
        useMutation: () => ({ mutate: save, isPending: false }),
      },
    },
    record: {
      marks: { list: { useQuery: () => ({ data: bookmarks, isLoading: false }) } },
      search: {
        useQuery: () => ({ data: { exact: results, similar: null }, isLoading: false }),
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

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import KeepThree from "./KeepThree";

describe("keeping three lines (C6.4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("chooses three, changes one, and saves", () => {
    render(<KeepThree personaId={5} name="小满" onDone={onDone} />);
    fireEvent.change(screen.getByPlaceholderText("在 TA 说过的话里找"), {
      target: { value: "晚安" },
    });
    fireEvent.click(screen.getByRole("button", { name: "找" }));

    const choose = () => screen.getAllByRole("button", { name: "选这一句" })[0]!;
    fireEvent.click(choose());
    fireEvent.click(choose());
    fireEvent.click(choose());
    expect(screen.getByText("已经选好的（3 / 3）")).toBeInTheDocument();
    // The fourth button is the bookmark's, still disabled at three.
    expect(screen.getAllByRole("button", { name: "选这一句" })).toHaveLength(1);

    fireEvent.click(screen.getAllByRole("button", { name: "不选这句" })[0]!);
    expect(screen.getByText("已经选好的（2 / 3）")).toBeInTheDocument();
    fireEvent.click(choose());
    fireEvent.click(screen.getByRole("button", { name: "留下这三句" }));
    expect(save).toHaveBeenCalledWith({ personaId: 5, recordIds: expect.any(Array) });
    expect(save.mock.calls[0][0].recordIds).toHaveLength(3);
  });

  it("skips without saving", () => {
    render(<KeepThree personaId={5} name="小满" onDone={onDone} />);
    fireEvent.click(screen.getByRole("button", { name: "以后再选" }));
    expect(save).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalled();
  });
});
