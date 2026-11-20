// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

/**
 * The counsellor summary's dialog (C4.6).
 *
 * Two opt-ins, both off by default; the file opens in a new tab. The
 * default has no conversation and no diary, and the words the persona
 * said are never in it at all.
 */
const build = vi.fn();
let buildOptions: any = null;

vi.mock("@/lib/trpc", () => ({
  trpc: {
    user: {
      exportCounselorSummary: {
        useMutation: (options: any) => {
          buildOptions = options;
          return { mutate: build, isPending: false };
        },
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

import CounselorExport from "./CounselorExport";

describe("the counsellor export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(URL, "createObjectURL", { value: vi.fn(() => "blob:summary"), configurable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), configurable: true });
    vi.spyOn(window, "open").mockImplementation(() => null);
  });

  it("has both extras off by default", async () => {
    const user = userEvent.setup();
    render(<CounselorExport />);
    await user.click(screen.getByRole("button", { name: translate("zh", "counselor.open") }));
    expect(screen.getByRole("checkbox", { name: translate("zh", "counselor.includeThemes") })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: translate("zh", "counselor.includeJournal") })).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: translate("zh", "counselor.build") }));
    expect(build).toHaveBeenCalledWith({ range: "30d", includeThemes: false, includeJournal: false });
  });

  it("passes the chosen range and the opt-ins", async () => {
    const user = userEvent.setup();
    render(<CounselorExport />);
    await user.click(screen.getByRole("button", { name: translate("zh", "counselor.open") }));
    await user.click(screen.getByRole("button", { name: translate("zh", "counselor.range90") }));
    await user.click(screen.getByRole("checkbox", { name: translate("zh", "counselor.includeJournal") }));
    await user.click(screen.getByRole("button", { name: translate("zh", "counselor.build") }));
    expect(build).toHaveBeenCalledWith({ range: "90d", includeThemes: false, includeJournal: true });
  });

  it("opens the generated page in a new tab", () => {
    render(<CounselorExport />);
    buildOptions.onSuccess({ html: "<html>ok</html>" });
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(window.open).toHaveBeenCalledWith("blob:summary", "_blank", "noopener,noreferrer");
  });
});
