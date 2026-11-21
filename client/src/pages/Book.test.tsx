// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { translate } from "@/i18n";

const inputs: any[] = [];
let bookOverrides: Record<string, unknown> = {};

function bookData(share: boolean) {
  return {
    share,
    cover: {
      name: share ? "小*" : "小满",
      togetherFrom: "2022-03-01",
      togetherTo: null,
    },
    letters: {
      theirs: "小满写给你的信。",
      yours: "我也想你了。",
    },
    timeline: [
      {
        id: "event:1",
        at: "2022-03-01T12:00:00.000Z",
        title: "第一次见面",
        detail: "那天下雨。",
      },
    ],
    keptQuotes: [
      { recordId: 9, text: "晚安呀", at: "2024-05-01T21:00:00.000Z" },
    ],
    bookmarks: [
      { recordId: 5, text: "那天海很蓝", at: "2024-05-02T12:00:00.000Z" },
    ],
    photoOptions: [
      { id: 11, url: "/uploads/a.jpg", at: "2024-01-01T12:00:00.000Z" },
    ],
    photos: [],
    ...bookOverrides,
  };
}

vi.mock("@/lib/trpc", () => ({
  trpc: {
    book: {
      get: {
        useQuery: (input: any) => {
          inputs.push(input);
          return {
            data: bookData(Boolean(input.share)),
            isLoading: false,
            isError: false,
            refetch: vi.fn(),
          };
        },
      },
    },
  },
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ isAuthenticated: true, loading: false }),
}));

vi.mock("wouter", () => ({
  useParams: () => ({ id: "1" }),
}));

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

import Book from "./Book";

describe("the keepsake book page (C6.3)", () => {
  beforeEach(() => {
    inputs.length = 0;
    bookOverrides = {};
  });

  it("shows the chosen parts of the book", () => {
    render(<Book />);
    expect(screen.getAllByText("小满").length).toBeGreaterThan(0);
    expect(screen.getByText("小满写给你的信。")).toBeInTheDocument();
    expect(screen.getByText("我也想你了。")).toBeInTheDocument();
    expect(screen.getByText("第一次见面")).toBeInTheDocument();
    expect(screen.getByText("「晚安呀」")).toBeInTheDocument();
    expect(screen.getByText("那天海很蓝")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: translate("zh", "book.photoAlt", { name: "小满" }) })).toBeInTheDocument();
  });

  it("leaves out a section that has nothing in it (C6.3)", () => {
    bookOverrides = { keptQuotes: [], bookmarks: [] };
    render(<Book />);
    expect(screen.queryByText(translate("zh", "book.keptQuotes"))).toBeNull();
    expect(screen.queryByText(translate("zh", "book.bookmarks"))).toBeNull();
  });

  it("asks the server again for the share copy", () => {
    render(<Book />);
    fireEvent.click(screen.getByLabelText(translate("zh", "book.share")));
    expect(inputs[inputs.length - 1]).toMatchObject({ personaId: 1, share: true });
    expect(screen.getAllByText("小*").length).toBeGreaterThan(0);
    expect(screen.getByText(translate("zh", "book.shareBanner"))).toBeInTheDocument();
  });

  it("prints through the browser, and the print stylesheet exists", () => {
    const print = vi.fn();
    vi.stubGlobal("print", print);
    render(<Book />);
    fireEvent.click(screen.getByText(translate("zh", "book.print")));
    expect(print).toHaveBeenCalledTimes(1);

    const css = readFileSync(
      path.resolve(__dirname, "../styles/book.css"),
      "utf8",
    );
    expect(css).toContain("@media print");
    expect(css).toContain(".book-document");
    vi.unstubAllGlobals();
  });
});
