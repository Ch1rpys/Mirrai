// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { translate } from "@/i18n";

const setSeal = vi.fn();
const requestOpen = vi.fn();
const cancelRequest = vi.fn();
const navigate = vi.fn();
const invalidatePersona = vi.fn();
let stored: any = {};
let encryptionEnabled = true;

vi.mock("wouter", () => ({
  useLocation: () => ["/persona/5/edit", navigate],
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    encryption: {
      status: { useQuery: () => ({ data: { enabled: encryptionEnabled } }) },
    },
    useUtils: () => ({ persona: { get: { invalidate: invalidatePersona } } }),
    persona: {
      getSettings: {
        useQuery: () => ({ data: stored, isLoading: false, isError: false, refetch: vi.fn() }),
      },
      seal: {
        set: {
          useMutation: (options?: { onSuccess?: (...args: any[]) => void }) => ({
            mutate: (value: any) => {
              setSeal(value);
              if (value?.until) options?.onSuccess?.(undefined, value);
            },
            isPending: false,
          }),
        },
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
    encryptionEnabled = true;
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

  it("goes to the seal page once the seal is set (C6.2)", () => {
    // The edit and graduation pages read `persona.get`, which the seal
    // refuses — so staying on this page after sealing would land the
    // user on an error screen. The controls they need are on the seal
    // page, and that is where the seal takes them.
    render(<SealSettings personaId={5} />);
    fireEvent.change(screen.getByLabelText("封存到哪天"), { target: { value: "2099-04-01" } });
    fireEvent.click(screen.getByRole("button", { name: "封存" }));
    expect(navigate).toHaveBeenCalledWith("/persona/5/seal");
  });

  it("suggests at-rest encryption while it is off (C6.2)", () => {
    encryptionEnabled = false;
    const { unmount } = render(<SealSettings personaId={5} />);
    expect(screen.getByText(translate("zh", "seal.encryptionHint"))).toBeInTheDocument();
    unmount();
    encryptionEnabled = true;
    render(<SealSettings personaId={5} />);
    expect(screen.queryByText(translate("zh", "seal.encryptionHint"))).toBeNull();
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
