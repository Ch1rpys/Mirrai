// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { translate } from "@/i18n";

const accept = vi.fn();
const navigate = vi.fn();
let authed = true;

vi.mock("wouter", () => ({
  useParams: () => ({ token: "a".repeat(32) }),
  useLocation: () => ["/share/x", navigate],
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    share: {
      preview: {
        useQuery: () => ({
          data: { ownerName: "阿树", personaName: "小满" },
          isLoading: false,
          isError: false,
        }),
      },
      accept: {
        useMutation: (options?: any) => ({
          mutate: (input: any) => {
            accept(input);
            options?.onSuccess?.({ personaId: 9 });
          },
          isPending: false,
          isError: false,
          error: null,
        }),
      },
    },
  },
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ isAuthenticated: authed, loading: false }),
}));

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

import ShareAccept from "./ShareAccept";

describe("accepting a shared persona (C7.2)", () => {
  it("shows the owner and the persona, then accepts", () => {
    authed = true;
    render(<ShareAccept />);
    expect(
      screen.getByText(translate("zh", "share.acceptTitle", { owner: "阿树", name: "小满" })),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText(translate("zh", "share.accept")));
    expect(accept).toHaveBeenCalledWith({ token: "a".repeat(32) });
    expect(navigate).toHaveBeenCalledWith("/chat/9");
  });

  it("asks a visitor to sign in first", () => {
    authed = false;
    render(<ShareAccept />);
    expect(screen.getByText(translate("zh", "share.signInFirst"))).toBeInTheDocument();
    expect(screen.queryByText(translate("zh", "share.accept"))).toBeNull();
  });
});
