// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { translate } from "@/i18n";

const mutate = vi.fn();
const refetch = vi.fn();
let queryState: {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
};

vi.mock("@/lib/trpc", () => ({
  trpc: {
    llmConfig: {
      getDefault: {
        useQuery: () => ({ ...queryState, refetch }),
      },
      updateExtraConfig: {
        useMutation: () => ({ mutate, isPending: false }),
      },
    },
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

import StructuredOutputSettings from "./StructuredOutputSettings";

describe("the request shape switches", () => {
  it("shows the effective state, not just the stored flag", () => {
    queryState = {
      data: { extraConfig: {}, supportsLogitBias: true, supportsGrammar: false },
      isLoading: false,
      isError: false,
    };
    render(<StructuredOutputSettings />);
    expect(screen.getByText("请求格式约束")).toBeInTheDocument();
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes[0]?.checked).toBe(true);
    expect(boxes[1]?.checked).toBe(false);
  });

  it("saves a switch the moment it is flipped", () => {
    queryState = {
      data: { extraConfig: {}, supportsLogitBias: false, supportsGrammar: false },
      isLoading: false,
      isError: false,
    };
    mutate.mockClear();
    render(<StructuredOutputSettings />);
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    fireEvent.click(boxes[1]!);
    expect(mutate).toHaveBeenCalledWith({ extraConfig: { supportsGrammar: true } });
  });

  it("can turn the official default off", () => {
    queryState = {
      data: { extraConfig: {}, supportsLogitBias: true, supportsGrammar: false },
      isLoading: false,
      isError: false,
    };
    mutate.mockClear();
    render(<StructuredOutputSettings />);
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    fireEvent.click(boxes[0]!);
    expect(mutate).toHaveBeenCalledWith({ extraConfig: { supportsLogitBias: false } });
  });

  it("offers a retry instead of an empty section when the request failed", () => {
    queryState = { data: undefined, isLoading: false, isError: true };
    refetch.mockClear();
    render(<StructuredOutputSettings />);
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(refetch).toHaveBeenCalled();
  });
});
