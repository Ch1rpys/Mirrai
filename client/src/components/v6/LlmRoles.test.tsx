// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { translate } from "@/i18n";

const mutate = vi.fn();
const defaultData = { extraConfig: { roles: { classify: "DeepSeek" } } };

vi.mock("@/lib/trpc", () => ({
  trpc: {
    llmConfig: {
      listProviders: {
        useQuery: () => ({ data: [{ name: "OpenAI" }, { name: "DeepSeek" }] }),
      },
      getDefault: {
        useQuery: () => ({
          data: defaultData,
          refetch: vi.fn(),
        }),
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

import LlmRoles from "./LlmRoles";

describe("the cheap-work roles", () => {
  it("renders the three role dropdowns and saves classify", () => {
    render(<LlmRoles />);
    expect(screen.getByText("分工")).toBeInTheDocument();
    expect(screen.getByText("判断情绪")).toBeInTheDocument();
    expect(screen.getByText("抽记忆")).toBeInTheDocument();
    expect(screen.getByText("写摘要")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存分工" }));
    expect(mutate).toHaveBeenCalledWith({
      extraConfig: { roles: { classify: "DeepSeek" } },
    });
  });
});
