// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { translate } from "@/i18n";

const countState: { value: any } = { value: undefined };

vi.mock("wouter", () => ({
  useLocation: () => ["/", vi.fn()],
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ isAuthenticated: true }),
}));

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
    letter: {
      unreadCount: { useQuery: () => countState.value },
    },
  },
}));

import MailboxEntry from "./MailboxEntry";

describe("the mailbox entry", () => {
  beforeEach(() => {
    countState.value = { data: { total: 0 }, isLoading: false };
  });

  it("draws no badge at zero", () => {
    render(<MailboxEntry />);
    expect(screen.queryByTestId("mailbox-count")).toBeNull();
    expect(
      screen.getByRole("button", { name: translate("zh", "mailbox.nav") }),
    ).toBeTruthy();
  });

  it("draws the number when something is waiting", () => {
    countState.value = { data: { total: 3 }, isLoading: false };
    render(<MailboxEntry />);
    expect(screen.getByTestId("mailbox-count").textContent).toBe("3");
    expect(
      screen.getByRole("button", {
        name: translate("zh", "mailbox.navWithCount", { count: 3 }),
      }),
    ).toBeTruthy();
  });

  it("caps a large number so it does not stretch the button", () => {
    countState.value = { data: { total: 250 }, isLoading: false };
    render(<MailboxEntry />);
    expect(screen.getByTestId("mailbox-count").textContent).toBe("99+");
  });
});
