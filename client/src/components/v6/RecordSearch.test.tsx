// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

const searchState: { value: any } = { value: undefined };
const lastInput: { value: any } = { value: undefined };
const onJump = vi.fn();
const fetchMore = vi.fn();

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ record: { search: { fetch: fetchMore } } }),
    record: {
      search: {
        useQuery: (input: any) => {
          lastInput.value = input;
          return searchState.value;
        },
      },
      context: {
        useQuery: () => ({
          data: {
            target: { id: 11, content: "在的呀" },
            before: [{ id: 10, content: "在吗" }],
            after: [{ id: 12, content: "刚下课" }],
          },
        }),
      },
    },
  },
}));

import RecordSearch from "./RecordSearch";

describe("the record search panel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMore.mockResolvedValue({ exact: [], similar: [], next: null });
    searchState.value = { data: undefined, isLoading: false, isError: false };
  });

  it("highlights the hit and shows both groups", async () => {
    searchState.value = {
      data: {
        exact: [{ id: 11, content: "我在海边等你", timestamp: "2022-03-01T12:00:00.000Z" }],
        similar: [{ id: 12, content: "沙滩那边风好大", timestamp: "2022-03-02T12:00:00.000Z" }],
        next: null,
        semanticTruncated: false,
      },
      isLoading: false,
      isError: false,
    };
    render(<RecordSearch personaId={5} name="小满" onJump={onJump} />);
    await userEvent.type(screen.getByRole("searchbox"), "海边");
    expect(lastInput.value).toMatchObject({ personaId: 5, q: "海边", role: "assistant" });
    expect(screen.getByText(translate("zh", "records.exactGroup"))).toBeInTheDocument();
    expect(screen.getByText(translate("zh", "records.similarGroup"))).toBeInTheDocument();
    expect(document.querySelector("mark")?.textContent).toBe("海边");
  });

  it("says only the literal search ran when the embedding model is missing", async () => {
    searchState.value = {
      data: { exact: [{ id: 11, content: "我在海边等你", timestamp: null }], similar: null, next: null },
      isLoading: false,
      isError: false,
    };
    render(<RecordSearch personaId={5} name="小满" onJump={onJump} />);
    await userEvent.type(screen.getByRole("searchbox"), "海边");
    expect(
      screen.getByText(translate("zh", "records.semanticUnavailable")),
    ).toBeInTheDocument();
  });

  it("says nothing was found, in the user's words", async () => {
    searchState.value = {
      data: { exact: [], similar: [], next: null },
      isLoading: false,
      isError: false,
    };
    render(<RecordSearch personaId={5} name="小满" onJump={onJump} />);
    await userEvent.type(screen.getByRole("searchbox"), "面");
    expect(screen.getByText(translate("zh", "records.noResults", { q: "面" }))).toBeInTheDocument();
  });

  it("shows who said a hit and loads the next page", async () => {
    searchState.value = {
      data: {
        exact: [
          { id: 11, content: "我在海边等你", timestamp: "2022-03-01T12:00:00.000Z", role: "assistant", speaker: "小满" },
        ],
        similar: [],
        next: "30",
        semanticTruncated: false,
      },
      isLoading: false,
      isError: false,
    };
    fetchMore.mockResolvedValue({
      exact: [
        { id: 12, content: "海风很大", timestamp: "2022-03-02T12:00:00.000Z", role: "user", speaker: "阿树" },
      ],
      similar: [],
      next: null,
    });
    render(<RecordSearch personaId={5} name="小满" onJump={onJump} />);
    await userEvent.type(screen.getByRole("searchbox"), "海边");
    expect(screen.getByText(/小满/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: translate("zh", "records.loadMore") }));
    expect(fetchMore).toHaveBeenCalledWith({ personaId: 5, q: "海边", role: "assistant", cursor: "30" });
    expect(screen.getByText("海风很大")).toBeInTheDocument();
    expect(screen.getByText(/我 · 2022-03-02/)).toBeInTheDocument();
  });

  it("jumps to the line and can show the lines around it", async () => {
    searchState.value = {
      data: {
        exact: [{ id: 11, content: "我在海边等你", timestamp: null }],
        similar: [],
        next: null,
      },
      isLoading: false,
      isError: false,
    };
    render(<RecordSearch personaId={5} name="小满" onJump={onJump} />);
    await userEvent.type(screen.getByRole("searchbox"), "海边");
    await userEvent.click(screen.getByRole("button", { name: "我在海边等你" }));
    expect(onJump).toHaveBeenCalledWith(11);
    await userEvent.click(screen.getByText(translate("zh", "records.showContext")));
    expect(screen.getByText("在吗")).toBeInTheDocument();
    expect(screen.getByText("刚下课")).toBeInTheDocument();
  });
});
