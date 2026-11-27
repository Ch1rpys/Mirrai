// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

const { status, setStatus, exportRefetch, createLink, purge, invalidateList } = vi.hoisted(() => ({
  status: vi.fn(),
  setStatus: vi.fn(),
  exportRefetch: vi.fn(),
  createLink: vi.fn(),
  purge: vi.fn(),
  invalidateList: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    consent: {
      status: { useQuery: () => status() },
      setStatus: {
        useMutation: (options?: { onSuccess?: () => void }) => ({
          mutate: (input: unknown) => {
            setStatus(input);
            options?.onSuccess?.();
          },
          isPending: false,
        }),
      },
      exportPage: {
        useQuery: () => ({ refetch: () => exportRefetch(), isFetching: false }),
      },
      createLink: {
        useMutation: () => ({
          mutateAsync: () => createLink(),
          isPending: false,
        }),
      },
    },
    persona: {
      purgeForConsent: {
        useMutation: (options?: { onSuccess?: () => void }) => ({
          mutate: (input: unknown) => {
            purge(input);
            options?.onSuccess?.();
          },
          isPending: false,
          isError: false,
          error: null,
          reset: () => undefined,
        }),
      },
      list: { invalidate: invalidateList },
    },
    useUtils: () => ({ persona: { list: { invalidate: invalidateList } } }),
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

import ConsentTools from "./ConsentTools";

const NOT_ASKED = { consent: "not_asked", link: null };

function withStatus(data: unknown, extra: Record<string, unknown> = {}) {
  status.mockReturnValue({ data, isLoading: false, isError: false, refetch: () => undefined, ...extra });
}

describe("asking the other person (C10.3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    withStatus(NOT_ASKED);
    exportRefetch.mockResolvedValue({ data: { html: "<!doctype html><p>hi</p>" } });
    createLink.mockResolvedValue({ path: `/consent/${"a".repeat(64)}`, expiresAt: "2026-12-27T00:00:00.000Z" });
  });

  it("shows the current status", () => {
    withStatus({ consent: "asked_yes", link: null });
    render(<ConsentTools personaId={5} name="小满" />);
    expect(screen.getByRole("status")).toHaveTextContent("问过，小满 说可以");
    expect(screen.getByText("去问 小满 一声")).toBeInTheDocument();
  });

  it("says it has not been asked, rather than leaving a blank", () => {
    render(<ConsentTools personaId={5} name="小满" />);
    expect(screen.getByRole("status")).toHaveTextContent("还没问");
  });

  it("does not turn a failed read into 'not asked yet'", () => {
    status.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: () => undefined,
    });
    render(<ConsentTools personaId={5} name="小满" />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
    expect(screen.queryByText("还没问")).toBeNull();
  });

  it("records a manual answer", async () => {
    const user = userEvent.setup();
    render(<ConsentTools personaId={5} name="小满" />);
    await user.selectOptions(screen.getByLabelText("我记一下对方怎么说的"), "asked_no");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(setStatus).toHaveBeenCalledWith({ personaId: 5, consent: "asked_no" });
  });

  it("generates a link and shows it", async () => {
    const user = userEvent.setup();
    render(<ConsentTools personaId={5} name="小满" />);
    await user.click(screen.getByRole("button", { name: "生成一条链接" }));
    const input = await screen.findByLabelText("生成一条链接");
    expect((input as HTMLInputElement).value).toMatch(/\/consent\/[0-9a-f]{64}$/);
    expect(invalidateList).not.toHaveBeenCalled();
  });

  it("offers the hard delete only after a no, and asks for the name", async () => {
    withStatus({ consent: "asked_no", link: null });
    const user = userEvent.setup();
    render(<ConsentTools personaId={5} name="小满" />);
    expect(screen.getByText("小满 说了不可以。")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "把这个分身和所有记录彻底删掉" }));
    expect(screen.getByText("输入 小满 的名字来确认。删掉之后没有任何办法恢复。")).toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: "删掉" });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText("名字"), "小满");
    await user.click(confirm);
    expect(purge).toHaveBeenCalledWith({ personaId: 5, confirmName: "小满" });
  });

  it("does not offer the hard delete before a no", () => {
    withStatus({ consent: "asked_yes", link: null });
    render(<ConsentTools personaId={5} name="小满" />);
    expect(screen.queryByRole("button", { name: "把这个分身和所有记录彻底删掉" })).toBeNull();
  });

  it("shows the link's expiry when there is one", () => {
    withStatus({
      consent: "not_asked",
      link: { expiresAt: "2026-12-27T00:00:00.000Z" },
    });
    render(<ConsentTools personaId={5} name="小满" />);
    expect(screen.getByText("2026-12-27 之前有效")).toBeInTheDocument();
  });

  it("downloads the page when asked", async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn(() => "blob:page");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    render(<ConsentTools personaId={5} name="小满" />);
    await user.click(screen.getByRole("button", { name: "下载一页说明" }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
    expect(click).toHaveBeenCalled();
    click.mockRestore();
  });
});
