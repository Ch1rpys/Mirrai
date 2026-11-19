// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

const updateMutation = vi.fn();
const uploadBackground = vi.fn();
const clearBackground = vi.fn();
const settingsData = vi.hoisted(() => ({
  value: {
    layers: {},
    skin: { theme: "classic", alias: "", background: "/uploads/personas/1/5/bg.png" },
  },
}));
const refetch = vi.fn();

vi.mock("@/lib/trpc", () => ({
  trpc: {
    persona: {
      getSettings: {
        useQuery: () => ({ data: settingsData.value, isLoading: false, refetch }),
      },
      updateSettings: { useMutation: () => ({ mutate: updateMutation, isPending: false }) },
      uploadBackground: { useMutation: () => ({ mutate: uploadBackground, isPending: false }) },
      clearBackground: { useMutation: () => ({ mutate: clearBackground, isPending: false }) },
    },
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

import SkinPicker from "./SkinPicker";

describe("the skin picker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the three neutral layouts and saves a different one", async () => {
    const user = userEvent.setup();
    render(<SkinPicker personaId={5} />);
    expect(screen.getByText("默认")).toBeInTheDocument();
    expect(screen.getByText("绿色气泡")).toBeInTheDocument();
    expect(screen.getByText("蓝色气泡")).toBeInTheDocument();
    await user.click(screen.getByText("绿色气泡"));
    expect(updateMutation).toHaveBeenCalledWith({
      id: 5,
      patch: { skin: { theme: "im-green", alias: "" } },
    });
  });

  it("saves a note above the name", async () => {
    const user = userEvent.setup();
    render(<SkinPicker personaId={5} />);
    await user.type(screen.getByPlaceholderText("显示在顶栏"), "小满");
    await user.click(screen.getByText("保存备注名"));
    expect(updateMutation).toHaveBeenCalledWith({
      id: 5,
      patch: { skin: { theme: "classic", alias: "小满" } },
    });
  });

  it("removes a background picture", async () => {
    const user = userEvent.setup();
    render(<SkinPicker personaId={5} />);
    expect(screen.getByAltText("聊天背景")).toBeInTheDocument();
    await user.click(screen.getByText("不用背景图"));
    expect(clearBackground).toHaveBeenCalledWith({ personaId: 5 });
  });
});
