// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { translate } from "@/i18n";

/**
 * The way out of a seal (C6.2).
 *
 * Sealing a persona is an agreement with yourself, not a one-way door:
 * the data can always be exported or deleted and the seal can be lifted.
 * The controls live on this page, and the page itself has to stay
 * reachable while the persona is sealed — so it reads the seal status
 * through the exempt route instead of `persona.get`.
 */
const navigate = vi.fn();
const setSeal = vi.fn();
const deletePersona = vi.fn();
const exportManual = vi.fn();

let statusState: any;
let settingsState: any;

vi.mock("wouter", () => ({
  useParams: () => ({ id: "5" }),
  useLocation: () => ["/persona/5/seal", navigate],
  Link: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a>,
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ persona: { get: { invalidate: vi.fn() } } }),
    encryption: {
      status: { useQuery: () => ({ data: { enabled: true } }) },
    },
    persona: {
      seal: {
        status: { useQuery: () => statusState },
        set: {
          useMutation: (options?: { onSuccess?: () => void }) => ({
            mutate: (value: any) => {
              setSeal(value);
              if (value?.until) options?.onSuccess?.();
            },
            isPending: false,
          }),
        },
        requestOpen: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        cancelRequest: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      },
      getSettings: { useQuery: () => settingsState },
      delete: { useMutation: () => ({ mutate: deletePersona, isPending: false }) },
      exportManual: {
        useQuery: () => ({ refetch: exportManual }),
      },
    },
  },
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: 1, username: "测试", timezone: "Asia/Shanghai" },
    isAuthenticated: true,
    loading: false,
    logout: vi.fn(),
    refresh: vi.fn(),
  }),
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
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import SealManage from "./SealManage";

describe("the seal page (C6.2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    statusState = {
      data: { id: 5, name: "小A", sealed: true, until: "2099-04-01", earlyOpen: "never", requestedAt: null },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
    settingsState = {
      data: { seal: { until: "2099-04-01", earlyOpen: "never" } },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
  });

  it("shows the sealed persona and the way to lift the seal", () => {
    render(<SealManage />);
    expect(screen.getByText("小A")).toBeInTheDocument();
    expect(screen.getByText("这个分身现在封存着，到 2099-04-01。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "打开封存" }));
    expect(setSeal).toHaveBeenCalledWith({ personaId: 5, until: null });
  });

  it("still lets the user take the data out", async () => {
    render(<SealManage />);
    fireEvent.click(screen.getByRole("button", { name: translate("zh", "graduationPage.takeItWithYou") }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/settings?tab=data"));
  });

  it("still lets the user delete the sealed persona", async () => {
    render(<SealManage />);
    fireEvent.click(screen.getByRole("button", { name: translate("zh", "seal.delete") }));
    expect(screen.getByText(translate("zh", "lobby.deleteDialog.title"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: translate("zh", "common.delete") }));
    await waitFor(() => expect(deletePersona).toHaveBeenCalledWith({ id: 5 }));
  });

  it("does not render a blank page when the status cannot be read", () => {
    statusState = { data: undefined, isLoading: false, isError: true, refetch: vi.fn() };
    render(<SealManage />);
    expect(screen.getByText(translate("zh", "seal.loadFailed"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: translate("zh", "common.retry") })).toBeInTheDocument();
  });
});
