// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { translate } from "@/i18n";

const { query } = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    style: {
      embedStatus: {
        useQuery: (...a: unknown[]) => query(...a),
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

import EmbedStatus from "./EmbedStatus";

describe("semantic retrieval status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows available when Ollama has the embedding model", () => {
    query.mockReturnValue({
      data: { status: "ready", model: "bge-m3" },
      isError: false,
      isLoading: false,
      refetch: vi.fn(),
    });
    render(<EmbedStatus />);
    expect(screen.getByText(translate("zh", "settings.ai.embedTitle"))).toBeInTheDocument();
    expect(screen.getByText(translate("zh", "settings.ai.embedReady"))).toBeInTheDocument();
    expect(screen.getByText(translate("zh", "settings.ai.embedHowReady"))).toBeInTheDocument();
  });

  it("shows that Ollama is missing", () => {
    query.mockReturnValue({
      data: { status: "no_ollama", model: "bge-m3" },
      isError: false,
      isLoading: false,
      refetch: vi.fn(),
    });
    render(<EmbedStatus />);
    expect(screen.getByText(translate("zh", "settings.ai.embedNoOllama"))).toBeInTheDocument();
    expect(screen.getByText(translate("zh", "settings.ai.embedHowOllama"))).toBeInTheDocument();
  });

  it("shows that the embedding model has not been pulled", () => {
    query.mockReturnValue({
      data: { status: "no_model", model: "bge-m3" },
      isError: false,
      isLoading: false,
      refetch: vi.fn(),
    });
    render(<EmbedStatus />);
    expect(screen.getByText(translate("zh", "settings.ai.embedNoModel"))).toBeInTheDocument();
    expect(
      screen.getByText(translate("zh", "settings.ai.embedHowModel", { model: "bge-m3" })),
    ).toBeInTheDocument();
  });
});
