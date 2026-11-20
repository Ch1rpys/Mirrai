// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

const capabilities = vi.hoisted(() => ({ visionProviders: [] as string[] }));
const previewMutate = vi.fn();
const confirmMutate = vi.fn();

vi.mock("@/lib/trpc", () => ({
  trpc: {
    system: {
      capabilities: {
        useQuery: () => ({
          data: { visionProviders: capabilities.visionProviders },
          isLoading: false,
        }),
      },
    },
    import: {
      momentsPreview: {
        useMutation: (options?: {
          onSuccess?: (data: unknown) => void;
        }) => ({
          mutate: (input: unknown) => {
            previewMutate(input);
            options?.onSuccess?.({
              posts: [
                { text: "今天去看了海。", at: "2024-06-01T04:00:00.000Z", timeApprox: true },
                { text: "周末在家。", at: "2024-06-01T04:01:00.000Z", timeApprox: true },
              ],
              failures: [],
            });
          },
          isPending: false,
        }),
      },
      momentsConfirm: {
        useMutation: (options?: { onSuccess?: (data: unknown) => void }) => ({
          mutate: (input: unknown) => {
            confirmMutate(input);
            options?.onSuccess?.({ written: 1 });
          },
          isPending: false,
        }),
      },
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

import MomentsImport from "./MomentsImport";

describe("importing moments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capabilities.visionProviders = ["OpenAI"];
  });

  it("greys the screenshot entry out and says why when no model can see", () => {
    capabilities.visionProviders = [];
    render(<MomentsImport personaId={5} />);
    expect(screen.getByText(translate("zh", "moments.noVision"))).toBeInTheDocument();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeDisabled();
  });

  it("reads the pasted posts, lets them be corrected, and keeps only the confirmed ones", async () => {
    const user = userEvent.setup();
    render(<MomentsImport personaId={5} />);
    const box = screen.getByPlaceholderText(translate("zh", "moments.placeholder"));
    await user.type(box, "今天去看了海。\n\n周末在家。");
    await user.click(screen.getByRole("button", { name: translate("zh", "moments.read") }));

    expect(previewMutate).toHaveBeenCalledWith(
      expect.objectContaining({ personaId: 5, text: "今天去看了海。\n\n周末在家。" }),
    );
    await waitFor(() =>
      expect(screen.getAllByLabelText(translate("zh", "moments.text"))).toHaveLength(2),
    );

    // Correct the first post, then drop the second.
    const texts = screen.getAllByLabelText(translate("zh", "moments.text"));
    await user.clear(texts[0]!);
    await user.type(texts[0]!, "今天去看了海。真好。");
    await user.click(screen.getAllByRole("button", { name: translate("zh", "moments.remove") })[1]!);

    await user.click(screen.getByRole("button", { name: translate("zh", "moments.confirm", { n: 1 }) }));
    expect(confirmMutate).toHaveBeenCalledWith({
      personaId: 5,
      posts: [
        {
          text: "今天去看了海。真好。",
          at: "2024-06-01T04:00:00.000Z",
        },
      ],
    });
  });
});
