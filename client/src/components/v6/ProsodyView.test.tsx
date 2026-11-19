// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

/**
 * The measured pace, and what is done with it.
 *
 * The rate and the pauses are shown as numbers; the trailing silence
 * is shown and labelled as unused, because the engines have no
 * parameter for it.
 */

const measure = vi.fn();
let measureResult: { prosody: unknown } | null = null;
let measureFails = false;

vi.mock("@/lib/trpc", () => ({
  trpc: {
    media: {
      measureProsody: {
        useMutation: (options?: any) => ({
          mutate: (input: any) => {
            measure(input);
            if (measureFails) options?.onError?.(new Error("no"));
            else options?.onSuccess?.(measureResult ?? { prosody: null });
          },
          isPending: false,
        }),
      },
    },
    useUtils: () => ({ persona: { get: { invalidate: vi.fn() } } }),
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

import ProsodyView from "./ProsodyView";

describe("the prosody panel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    measureResult = null;
    measureFails = false;
  });

  it("shows the three measured numbers", () => {
    render(
      <ProsodyView
        personaId={5}
        name="小满"
        prosody={{ charsPerSec: 5.04, pauseRatio: 0.3, tailSec: 0.4, samples: 12 }}
      />,
    );
    expect(screen.getByText(translate("zh", "prosody.title", { name: "小满" }))).toBeInTheDocument();
    expect(screen.getByText("每秒 5.04 个字")).toBeInTheDocument();
    expect(screen.getByText("占 30%")).toBeInTheDocument();
    expect(screen.getByText("0.4 秒")).toBeInTheDocument();
    expect(screen.getByText(translate("zh", "prosody.tailNote"))).toBeInTheDocument();
  });

  it("says a pause is not measured rather than zero", () => {
    render(
      <ProsodyView
        personaId={5}
        name="小满"
        prosody={{ charsPerSec: 4.5, samples: 12 }}
      />,
    );
    expect(screen.getAllByText(translate("zh", "prosody.notMeasured"))).toHaveLength(2);
  });

  it("offers to measure and says when there is not enough", async () => {
    const user = userEvent.setup();
    render(<ProsodyView personaId={5} name="小满" />);
    expect(
      screen.getByText(translate("zh", "prosody.empty", { name: "小满" })),
    ).toBeInTheDocument();
    await user.click(screen.getByText(translate("zh", "prosody.measure")));
    expect(measure).toHaveBeenCalledWith({ personaId: 5 });
    expect(screen.getByText(translate("zh", "prosody.tooFew"))).toBeInTheDocument();
  });
});
