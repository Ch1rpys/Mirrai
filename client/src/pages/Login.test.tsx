// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { translate } from "@/i18n";

/**
 * The sign-in page (C8.3).
 *
 * When the instance has no account at all, the first-run page also offers
 * a restore from a backup. It is mounted *beside* the sign-in form, which
 * stays exactly as it was — and it disappears, without a trace, as soon
 * as there is an account.
 */

vi.mock("wouter", () => ({
  useLocation: () => ["/login", vi.fn()],
  useSearch: () => "",
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ auth: { me: { refetch: vi.fn() } } }),
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

import Login from "./Login";

function availability(available: boolean) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ available }) }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the first-run page", () => {
  it("keeps the sign-in form, and hides the restore panel once an account exists", async () => {
    availability(false);
    render(<Login />);

    expect(screen.getByLabelText(translate("zh", "auth.username"))).toBeInTheDocument();
    expect(screen.getByLabelText(translate("zh", "auth.password"))).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId("restore-checking")).toBeNull());
    expect(screen.queryByTestId("restore-backup-panel")).toBeNull();
  });

  it("offers the restore from a backup on a completely new instance", async () => {
    availability(true);
    render(<Login />);

    expect(await screen.findByTestId("restore-backup-panel")).toBeInTheDocument();
    // The form above is untouched.
    expect(
      screen.getByRole("button", { name: translate("zh", "auth.login") }),
    ).toBeInTheDocument();
  });
});
