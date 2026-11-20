// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { translate } from "@/i18n";

const setSeal = vi.fn();
const requestOpen = vi.fn();
const cancelRequest = vi.fn();
let stored: any = {};

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ persona: { get: { invalidate: vi.fn() } } }),
    persona: {
      getSettings: {
        useQuery: () => ({ data: stored, isLoading: false, isError: false, refetch: vi.fn() }),
      },
      seal: {
        set: { useMutation: () => ({ mutate: setSeal, isPending: false }) },
        requestOpen: { useMutation: () => ({ mutate: requestOpen, isPending: false }) },
        cancelRequest: { useMutation: () => ({ mutate: cancelRequest, isPending: false }) },
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

import SealSettings from "./SealSettings";

describe("sealing a persona (C6.2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stored = {};
  });

  it("seals until a day, with the early-open choice", () => {
    render(<SealSettings personaId={5} />);
    fireEvent.change(screen.getByLabelText("封存到哪天"), { target: { value: "2099-04-01" } });
    fireEvent.click(screen.getByLabelText("可以申请提前打开，但要等三天"));
    fireEvent.click(screen.getByRole("button", { name: "封存" }));
    expect(setSeal).toHaveBeenCalledWith({
      personaId: 5,
      until: "2099-04-01",
      earlyOpen: "cooling",
    });
  });

  it("does not seal without a day", () => {
    render(<SealSettings personaId={5} />);
    fireEvent.click(screen.getByRole("button", { name: "封存" }));
    expect(setSeal).not.toHaveBeenCalled();
  });

  it("shows a sealed persona and can open it", () => {
    stored = { seal: { until: "2099-04-01", earlyOpen: "never" } };
    render(<SealSettings personaId={5} />);
    expect(screen.getByText("这个分身现在封存着，到 2099-04-01。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "打开封存" }));
    expect(setSeal).toHaveBeenCalledWith({ personaId: 5, until: null });
  });

  it("asks to open early only when the seal allows it", () => {
    stored = { seal: { until: "2099-04-01", earlyOpen: "never" } };
    const { unmount } = render(<SealSettings personaId={5} />);
    expect(screen.queryByRole("button", { name: "申请提前打开" })).toBeNull();
    unmount();
    stored = { seal: { until: "2099-04-01", earlyOpen: "cooling" } };
    render(<SealSettings personaId={5} />);
    fireEvent.click(screen.getByRole("button", { name: "申请提前打开" }));
    expect(requestOpen).toHaveBeenCalledWith({ personaId: 5 });
  });
});
