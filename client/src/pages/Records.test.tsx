// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

const pageState: { value: any } = { value: undefined };
const outlineState: { value: any } = { value: undefined };
const marksState: { value: any } = { value: undefined };
const searchState: { value: any } = { value: undefined };
const lastPageInput: { value: any } = { value: undefined };
const refetch = vi.fn();
const addMark = vi.fn();
const removeMark = vi.fn();
const deleteRow = vi.fn();
const confirm = vi.fn();

vi.mock("wouter", () => ({
  useParams: () => ({ id: "5" }),
  useLocation: () => ["/persona/5/records", vi.fn()],
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 1, timezone: "Asia/Shanghai" } }),
}));

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

vi.mock("@/components/ConfirmDialog", () => ({
  useConfirm: () => confirm,
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      record: { marks: { list: { invalidate: vi.fn() } } },
    }),
    persona: {
      get: { useQuery: () => ({ data: { id: 5, name: "小满" }, isLoading: false }) },
    },
    record: {
      page: {
        useQuery: (input: any) => {
          lastPageInput.value = input;
          return pageState.value;
        },
      },
      outline: { useQuery: () => outlineState.value },
      search: { useQuery: () => searchState.value },
      context: { useQuery: () => ({ data: undefined }) },
      marks: {
        list: { useQuery: () => marksState.value },
        add: { useMutation: () => ({ mutate: addMark }) },
        remove: { useMutation: () => ({ mutate: removeMark }) },
      },
      delete: { useMutation: () => ({ mutate: deleteRow }) },
    },
  },
}));

import Records from "./Records";

const row = {
  id: 11,
  role: "assistant",
  speaker: "小满",
  kind: "text",
  timestamp: "2022-03-01T12:00:00.000Z",
  content: "在的呀",
  source: "wechat_export",
  fileId: 7,
  meta: null,
  media: null,
  harmful: false,
  marks: [],
};

describe("the record reader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/persona/5/records");
    pageState.value = {
      data: { rows: [row], hasOlder: true, hasNewer: false },
      isLoading: false,
      isError: false,
      refetch,
    };
    outlineState.value = {
      data: {
        months: [{ month: "2022-03", count: 1 }],
        periods: [{ id: "p1", label: "开始", from: "2022-03-01T00:00:00.000Z", to: null }],
      },
    };
    marksState.value = { data: [] };
    searchState.value = { data: undefined, isLoading: false, isError: false };
    confirm.mockResolvedValue(true);
  });

  it("opens at ?at= and marks that line", async () => {
    window.history.replaceState({}, "", "/persona/5/records?at=11");
    render(<Records />);
    expect(lastPageInput.value).toMatchObject({
      personaId: 5,
      anchor: { recordId: 11 },
      direction: "around",
    });
    const line = await screen.findByText("在的呀");
    expect(line.closest("[data-record-id]")?.getAttribute("data-record-id")).toBe("11");
    expect(line.closest("[data-record-id]")?.className).toContain("ring-2");
  });

  it("adds a bookmark and shows it in the sidebar", async () => {
    render(<Records />);
    await screen.findByText("在的呀");
    await userEvent.click(screen.getByRole("button", { name: translate("zh", "records.bookmark") }));
    expect(addMark).toHaveBeenCalledWith({ personaId: 5, recordId: 11, kind: "bookmark" });

    marksState.value = {
      data: [{
        id: 3,
        recordId: 11,
        kind: "bookmark",
        note: null,
        createdAt: "2022-03-01T12:00:00.000Z",
        content: "在的呀",
        timestamp: "2022-03-01T12:00:00.000Z",
      }],
    };
    render(<Records />);
    expect(await screen.findByRole("button", { name: "在的呀" })).toBeInTheDocument();
  });

  it("folds a line the harm filter flagged until the user opens it", async () => {
    pageState.value = {
      data: { rows: [{ ...row, harmful: true, content: "你真没用" }], hasOlder: false, hasNewer: false },
      isLoading: false,
      isError: false,
      refetch,
    };
    render(<Records />);
    expect(screen.queryByText("你真没用")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: translate("zh", "records.open") }));
    expect(await screen.findByText("你真没用")).toBeInTheDocument();
  });

  it("shows a retry, not the empty state, when the read failed", async () => {
    pageState.value = { data: undefined, isLoading: false, isError: true, refetch };
    render(<Records />);
    expect(screen.getByText(translate("zh", "records.failed"))).toBeInTheDocument();
    expect(screen.queryByText(translate("zh", "records.empty"))).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: translate("zh", "records.retry") }));
    expect(refetch).toHaveBeenCalled();
  });

  it("shows the empty state only when the record really is empty", async () => {
    pageState.value = {
      data: { rows: [], hasOlder: false, hasNewer: false },
      isLoading: false,
      isError: false,
      refetch,
    };
    render(<Records />);
    expect(screen.getByText(translate("zh", "records.empty"))).toBeInTheDocument();
  });

  it("asks for confirmation before removing a line", async () => {
    render(<Records />);
    await screen.findByText("在的呀");
    await userEvent.click(screen.getByRole("button", { name: translate("zh", "records.delete") }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(deleteRow).toHaveBeenCalledWith({ personaId: 5, recordId: 11 });
  });

  it("jumps to a searched line and puts ?at= in the address bar", async () => {
    searchState.value = {
      data: {
        exact: [{ id: 11, content: "喜欢海", timestamp: "2022-03-01T12:00:00.000Z" }],
        similar: [],
        next: null,
      },
      isLoading: false,
      isError: false,
    };
    render(<Records />);
    await screen.findByText("在的呀");
    await userEvent.type(
      screen.getByRole("searchbox", { name: translate("zh", "records.search", { name: "小满" }) }),
      "海",
    );
    await userEvent.click(await screen.findByRole("button", { name: "喜欢海" }));
    expect(window.location.search).toContain("at=11");
    expect(lastPageInput.value).toMatchObject({ anchor: { recordId: 11 }, direction: "around" });
    // The point of the jump is to see the line, not only to load it.
    expect(
      document.querySelector('[data-record-id="11"]')?.className,
    ).toContain("ring-2");
  });

  it("groups the chapters by year and folds them into a drawer on a narrow screen", async () => {
    outlineState.value = {
      data: {
        months: [
          { month: "2022-03", count: 1 },
          { month: "2023-07", count: 2 },
        ],
        periods: [],
      },
    };
    render(<Records />);
    await screen.findByText("在的呀");
    expect(screen.getByText("2022")).toBeInTheDocument();
    expect(screen.getByText("2023")).toBeInTheDocument();
    const drawer = screen.getByRole("button", { name: translate("zh", "records.chapters") });
    expect(drawer).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(drawer);
    expect(drawer).toHaveAttribute("aria-expanded", "true");
  });

  it("loads older lines from the first row it has", async () => {
    render(<Records />);
    await screen.findByText("在的呀");
    await userEvent.click(screen.getByRole("button", { name: translate("zh", "records.older") }));
    expect(lastPageInput.value).toMatchObject({
      anchor: { recordId: 11 },
      direction: "older",
    });
  });
});
