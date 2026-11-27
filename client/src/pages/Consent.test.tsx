// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

const { page, answer } = vi.hoisted(() => ({
  page: vi.fn(),
  answer: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    consent: {
      getByToken: { useQuery: () => page() },
      answer: {
        useMutation: (options?: { onSuccess?: () => void }) => ({
          mutate: (input: unknown) => {
            answer(input);
            options?.onSuccess?.();
          },
          isPending: false,
          isError: false,
        }),
      },
    },
  },
}));

vi.mock("wouter", () => ({
  useParams: () => ({ token: "a".repeat(64) }),
}));

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

import Consent from "./Consent";

describe("the consent page (C10.3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    page.mockReturnValue({ data: { name: "小满" }, isLoading: false, isError: false });
  });

  it("asks crawlers not to index it", () => {
    render(<Consent />);
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe(
      "noindex",
    );
  });

  it("says what it is, where the data is, and that a no is possible", () => {
    render(<Consent />);
    expect(screen.getByText(/小满/)).toBeInTheDocument();
    expect(screen.getByText("这是什么")).toBeInTheDocument();
    expect(screen.getByText("数据在哪里")).toBeInTheDocument();
    expect(screen.getByText("你可以说不")).toBeInTheDocument();
    expect(
      screen.getByText(/不公开、不给别人、不模仿你的声音、不生成你的照片/),
    ).toBeInTheDocument();
  });

  it("offers exactly two answers", () => {
    render(<Consent />);
    expect(screen.getByRole("button", { name: "可以" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "不可以" })).toBeInTheDocument();
  });

  it("sends the answer", async () => {
    const user = userEvent.setup();
    render(<Consent />);
    await user.click(screen.getByRole("button", { name: "不可以" }));
    expect(answer).toHaveBeenCalledWith({ token: "a".repeat(64), answer: "no" });
  });

  it("thanks them after the answer", async () => {
    const user = userEvent.setup();
    render(<Consent />);
    await user.click(screen.getByRole("button", { name: "可以" }));
    expect(screen.getByRole("status")).toHaveTextContent("已经记下了");
  });

  it("shows the same message for an invalid link", () => {
    page.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    render(<Consent />);
    expect(screen.getByRole("alert")).toHaveTextContent("这个链接已经不能用了。");
    expect(screen.queryByRole("button", { name: "可以" })).toBeNull();
  });
});
