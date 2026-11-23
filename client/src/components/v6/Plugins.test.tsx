// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { translate } from "@/i18n";

const state: {
  data: any;
  isError: boolean;
  isLoading: boolean;
  refetch: ReturnType<typeof vi.fn>;
} = { data: undefined, isError: false, isLoading: false, refetch: vi.fn() };

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
    plugins: {
      list: { useQuery: () => state },
    },
  },
}));

import Plugins from "./Plugins";

function setState(partial: Partial<typeof state>) {
  Object.assign(state, {
    data: undefined,
    isError: false,
    isLoading: false,
    refetch: vi.fn(),
    ...partial,
  });
}

describe("the loaded plugins panel", () => {
  it("says plugins are off when the switch is off", () => {
    setState({ data: { enabled: false, plugins: [] } });
    render(<Plugins />);
    expect(screen.getByText(translate("zh", "settings.data.pluginsTitle"))).toBeInTheDocument();
    expect(screen.getByText(translate("zh", "settings.data.pluginsNote"))).toBeInTheDocument();
    expect(screen.getByText(translate("zh", "settings.data.pluginsOff"))).toBeInTheDocument();
  });

  it("lists each plugin with its kind and declared addresses", () => {
    setState({
      data: {
        enabled: true,
        plugins: [
          {
            name: "sample-importer",
            version: "0.2.0",
            kind: "importer",
            id: "plugin:sample-importer:sample",
            egress: ["https://records.example.com/upload"],
          },
          {
            name: "demo-channel",
            version: "3.0.0",
            kind: "channel",
            id: "plugin:demo-channel:demo",
            egress: [],
          },
        ],
      },
    });
    render(<Plugins />);
    expect(screen.getByText("sample-importer")).toBeInTheDocument();
    expect(screen.getByText(/0\.2\.0/)).toBeInTheDocument();
    expect(screen.getByText(translate("zh", "settings.data.pluginsKindImporter"))).toBeInTheDocument();
    expect(screen.getByText("plugin:sample-importer:sample")).toBeInTheDocument();
    expect(screen.getByText("https://records.example.com/upload")).toBeInTheDocument();
    expect(screen.getByText("demo-channel")).toBeInTheDocument();
    expect(screen.getByText(translate("zh", "settings.data.pluginsKindChannel"))).toBeInTheDocument();
    expect(screen.getByText(translate("zh", "settings.data.pluginsNoEgress"))).toBeInTheDocument();
  });

  it("says there are none when the switch is on but nothing was loaded", () => {
    setState({ data: { enabled: true, plugins: [] } });
    render(<Plugins />);
    expect(screen.getByText(translate("zh", "settings.data.pluginsEmpty"))).toBeInTheDocument();
  });

  it("shows a failure with a retry instead of an empty list", () => {
    setState({ isError: true });
    render(<Plugins />);
    expect(screen.getByText(translate("zh", "settings.data.pluginsLoadFailed"))).toBeInTheDocument();
    const retry = screen.getByRole("button", {
      name: translate("zh", "settings.data.pluginsRetry"),
    });
    fireEvent.click(retry);
    expect(state.refetch).toHaveBeenCalledTimes(1);
  });
});
