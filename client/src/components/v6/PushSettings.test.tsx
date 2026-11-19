// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { translate } from "@/i18n";

const requestPermission = vi.fn();

vi.mock("@/lib/trpc", () => ({
  trpc: {
    push: {
      publicKey: {
        useQuery: () => ({ data: undefined, isError: false, isLoading: false, refetch: vi.fn() }),
      },
      list: {
        useQuery: () => ({ data: [], isError: false, isLoading: false, refetch: vi.fn() }),
      },
      subscribe: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      unsubscribe: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      setPreview: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      test: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
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

import PushSettings from "./PushSettings";

describe("push settings", () => {
  beforeEach(() => {
    requestPermission.mockReset();
    delete (window as unknown as { PushManager?: unknown }).PushManager;
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: { permission: "default", requestPermission },
    });
  });

  it("says the browser cannot do it, and does not ask for permission by rendering", () => {
    render(<PushSettings />);
    expect(screen.getByText(translate("zh", "settings.data.pushUnsupported"))).toBeInTheDocument();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(requestPermission).not.toHaveBeenCalled();
  });
});
