// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { translate } from "@/i18n";

const mutate = vi.fn();
const defaultData = { extraConfig: { extraBody: { enable_thinking: false } } };

vi.mock("@/lib/trpc", () => ({
  trpc: {
    llmConfig: {
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

import ExtraBodyEditor from "./ExtraBodyEditor";

describe("the extra request body editor", () => {
  it("rejects text that is not a JSON object", () => {
    render(<ExtraBodyEditor />);
    expect(screen.getByText("额外请求参数")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "not json" } });
    fireEvent.click(screen.getByRole("button", { name: "保存额外参数" }));
    expect(screen.getByRole("alert")).toHaveTextContent("这不是一个 JSON 对象。");
    expect(mutate).not.toHaveBeenCalled();
  });
});
