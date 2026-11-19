// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

const capabilities = vi.hoisted(() => ({ visionProviders: ["OpenAI"] as string[] }));
const previewMutate = vi.fn();
const confirmMutate = vi.fn();

vi.mock("@/lib/trpc", () => ({
  trpc: {
    system: {
      capabilities: {
        useQuery: () => ({
          data: { visionProviders: capabilities.visionProviders, defaultProvider: "OpenAI" },
          isLoading: false,
        }),
      },
    },
    import: {
      screenshotPreview: {
        useMutation: (options?: any) => ({
          mutate: (input: any) => {
            previewMutate(input);
            options?.onSuccess?.({
              rows: [
                {
                  role: "assistant",
                  content: "在吗",
                  kind: "text",
                  at: "2024-06-01T04:30:00.000Z",
                  unclear: false,
                },
                {
                  role: "user",
                  content: "在",
                  kind: "text",
                  at: "2024-06-01T04:30:01.000Z",
                  unclear: true,
                },
              ],
              timeApprox: false,
              needsDate: false,
              failures: [],
              providerName: "OpenAI",
            });
          },
          isPending: false,
        }),
      },
      screenshotConfirm: {
        useMutation: (options?: any) => ({
          mutate: (input: any) => {
            confirmMutate(input);
            options?.onSuccess?.({ written: 2 });
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

import ScreenshotImport from "./ScreenshotImport";

class FakeFileReader {
  result: string | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readAsDataURL() {
    this.result = "data:image/png;base64,AAAA";
    setTimeout(() => this.onload?.(), 0);
  }
}

function chooseScreenshot() {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(["hello"], "chat.png", { type: "image/png" });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return input;
}

describe("importing screenshots", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("FileReader", FakeFileReader);
    capabilities.visionProviders = ["OpenAI"];
  });

  it("greys the entry out when no model can see", () => {
    capabilities.visionProviders = [];
    render(<ScreenshotImport personaId={5} personaName="小满" />);
    expect(screen.getByText(translate("zh", "screenshot.noVision"))).toBeInTheDocument();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeDisabled();
  });

  it("edits, flips, deletes, and confirms the rows", async () => {
    const user = userEvent.setup();
    render(<ScreenshotImport personaId={5} personaName="小满" />);
    chooseScreenshot();
    await waitFor(() => expect(screen.getByText(translate("zh", "screenshot.chosen", { n: 1 }))).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: translate("zh", "screenshot.recognize") }));

    expect(previewMutate).toHaveBeenCalledWith(
      expect.objectContaining({ personaId: 5, images: [{ name: "chat.png", base64: "data:image/png;base64,AAAA" }] }),
    );
    const textInputs = screen.getAllByLabelText(translate("zh", "screenshot.text"));
    await user.clear(textInputs[0]!);
    await user.type(textInputs[0]!, "在吗？");

    const sides = screen.getAllByLabelText(translate("zh", "screenshot.side"));
    await user.selectOptions(sides[0]!, "right");

    await user.click(screen.getAllByRole("button", { name: translate("zh", "screenshot.remove") })[1]!);

    await user.click(screen.getByRole("button", { name: translate("zh", "screenshot.confirm", { n: 1 }) }));
    expect(confirmMutate).toHaveBeenCalledWith({
      personaId: 5,
      rows: [
        {
          role: "user",
          content: "在吗？",
          kind: "text",
          at: "2024-06-01T04:30:00.000Z",
        },
      ],
    });
  });
});
