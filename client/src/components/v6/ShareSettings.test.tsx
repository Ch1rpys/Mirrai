// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { translate } from "@/i18n";

const invite = vi.fn();
let persona: any;

vi.mock("@/lib/trpc", () => ({
  trpc: {
    persona: {
      get: { useQuery: () => ({ data: persona, isLoading: false }) },
    },
    share: {
      list: { useQuery: () => ({ data: [], refetch: vi.fn() }) },
      invite: {
        useMutation: (options?: any) => ({
          mutate: (input: any) => {
            invite(input);
            options?.onSuccess?.({ link: "/share/abc" });
          },
          isPending: false,
        }),
      },
      revoke: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
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

import ShareSettings from "./ShareSettings";

describe("the sharing panel (C7.2)", () => {
  it("says what the other person can and cannot see, then creates a link", () => {
    persona = { id: 5, userId: 1, name: "小满", sharedFromPersonaId: null };
    render(<ShareSettings personaId={5} name="小满" />);
    expect(
      screen.getByText(translate("zh", "share.dialogNote", { name: "小满" })),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText(translate("zh", "share.invite")));
    expect(invite).toHaveBeenCalledWith({ personaId: 5 });
    expect(screen.getByText(/\/share\/abc/)).toBeInTheDocument();
  });

  it("does not offer the owner's controls to a member", () => {
    persona = { id: 9, userId: 2, name: "小满", sharedFromPersonaId: 5 };
    render(<ShareSettings personaId={9} name="小满" />);
    expect(
      screen.getByText(translate("zh", "share.memberNote", { name: "小满" })),
    ).toBeInTheDocument();
    expect(screen.queryByText(translate("zh", "share.invite"))).toBeNull();
  });
});
