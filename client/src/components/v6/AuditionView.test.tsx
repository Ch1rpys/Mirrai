// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

const auditionMutate = vi.fn();
const updateMutate = vi.fn();

let onAuditionSuccess: ((report: unknown) => void) | undefined;
/** What the mocked audition reports back; a test can add a failed row. */
let reportRows: Array<Record<string, unknown>> = [
  {
    id: "long",
    providerName: "long",
    model: "essay",
    label: "long · essay",
    composite: 0.1,
    overlap: 0.2,
    styleDistance: 0.8,
    residueRate: 0.4,
    avgChars: 80,
    avgMs: 40,
  },
  {
    id: "ta",
    providerName: "openai",
    model: "voice",
    label: "openai · voice",
    composite: 0.9,
    overlap: 0.8,
    styleDistance: 0.1,
    residueRate: 0.05,
    avgChars: 8,
    avgMs: 20,
  },
];
const defaultReportRows = reportRows;

vi.mock("@/lib/trpc", () => ({
  trpc: {
    eval: {
      auditionInfo: {
        useQuery: () => ({
          data: { count: 2, cases: 12, calls: 24 },
        }),
      },
      audition: {
        useMutation: (opts: { onSuccess?: (report: unknown) => void }) => {
          onAuditionSuccess = opts.onSuccess;
          return {
            mutate: (input: unknown) => {
              auditionMutate(input);
              onAuditionSuccess?.({
                results: reportRows,
                cases: 12,
                calls: 24,
              });
            },
            isPending: false,
          };
        },
      },
    },
    persona: {
      update: {
        useMutation: () => ({
          mutate: (...a: unknown[]) => updateMutate(...a),
          isPending: false,
        }),
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

import AuditionView from "./AuditionView";

describe("the audition table", () => {
  beforeEach(() => {
    auditionMutate.mockReset();
    updateMutate.mockReset();
    reportRows = defaultReportRows;
  });

  it("sorts the table by composite, highest first", async () => {
    const user = userEvent.setup();
    render(<AuditionView personaId={7} />);
    expect(
      screen.getByText(translate("zh", "fidelity.audition.hint", { count: 2, cases: 12, calls: 24 })),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: translate("zh", "fidelity.audition.run") }));
    expect(auditionMutate).toHaveBeenCalledWith({ personaId: 7, locale: "zh" });
    const labels = screen.getAllByText(/openai · voice|long · essay/).map((node) => node.textContent);
    expect(labels[0]).toBe("openai · voice");
    expect(labels[1]).toBe("long · essay");
  });

  it("writes the chosen provider onto the persona", async () => {
    const user = userEvent.setup();
    render(<AuditionView personaId={7} />);
    await user.click(screen.getByRole("button", { name: translate("zh", "fidelity.audition.run") }));
    const apply = screen.getAllByRole("button", { name: translate("zh", "fidelity.audition.useThis") });
    await user.click(apply[0]!);
    expect(updateMutate).toHaveBeenCalledWith({ id: 7, llmProvider: "openai" });
  });

  it("shows the provider's own reason for a failed candidate", async () => {
    reportRows = [
      {
        id: "unreachable",
        providerName: "ollama",
        model: "llama3",
        label: "ollama · llama3",
        failedCases: 12,
        attemptedCases: 12,
        error: "12/12 道题没有答出来：connect ECONNREFUSED 127.0.0.1:11434",
      },
      {
        id: "ta",
        providerName: "openai",
        model: "voice",
        label: "openai · voice",
        composite: 0.9,
      },
    ];
    const user = userEvent.setup();
    render(<AuditionView personaId={7} />);
    await user.click(screen.getByRole("button", { name: translate("zh", "fidelity.audition.run") }));
    await waitFor(() => {
      expect(screen.getByText(/connect ECONNREFUSED/)).toBeInTheDocument();
    });
    // The unreachable model cannot be chosen for the persona.
    expect(screen.getAllByRole("button", { name: translate("zh", "fidelity.audition.useThis") })).toHaveLength(1);
  });
});
