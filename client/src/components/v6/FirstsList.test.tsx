// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

const firstsState = vi.hoisted(() => ({
  value: [
    { key: "firstLine", recordId: 1, at: "2022-03-01T12:00:00.000Z", text: "在吗", side: "me" },
    { key: "firstGoodnightThem", recordId: 2, at: "2022-03-02T12:00:00.000Z", text: "晚安", side: "them" },
    { key: "lastCall", recordId: 3, at: "2024-10-01T12:00:00.000Z", text: "[call:voice:600]", side: "them" },
  ] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    record: {
      firsts: {
        useQuery: () => ({
          data: firstsState.value,
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        }),
      },
    },
  },
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 1, timezone: "Asia/Shanghai" } }),
}));

import FirstsList from "./FirstsList";

const defaultFirsts = [
  { key: "firstLine", recordId: 1, at: "2022-03-01T12:00:00.000Z", text: "在吗", side: "me" },
  { key: "firstGoodnightThem", recordId: 2, at: "2022-03-02T12:00:00.000Z", text: "晚安", side: "them" },
  { key: "lastCall", recordId: 3, at: "2024-10-01T12:00:00.000Z", text: "[call:voice:600]", side: "them" },
];

describe("the firsts list", () => {
  beforeEach(() => {
    firstsState.value = defaultFirsts;
  });

  it("shows the day where the person lived it (C2.6)", () => {
    // 00:30 in Shanghai is 16:30 UTC the day before; the list used to
    // print the UTC date, so the first line looked a day early.
    firstsState.value = [
      { key: "firstLine", recordId: 1, at: "2022-03-01T16:30:00.000Z", text: "在吗", side: "me" },
    ];
    render(<FirstsList personaId={5} mayFeature />);
    expect(screen.getByText("2022-03-02")).toBeInTheDocument();
    expect(screen.queryByText("2022-03-01")).toBeNull();
  });

  it("shows the endings for a persona the hall may feature", () => {
    render(<FirstsList personaId={5} mayFeature />);
    expect(screen.getByText(translate("zh", "report.firsts.firstLine"))).toBeInTheDocument();
    expect(screen.getByText(translate("zh", "report.firsts.lastCall"))).toBeInTheDocument();
  });

  it("folds the endings away until asked", async () => {
    render(<FirstsList personaId={5} mayFeature={false} />);
    expect(screen.queryByText(translate("zh", "report.firsts.lastCall"))).not.toBeInTheDocument();
    expect(screen.getByText(translate("zh", "report.firsts.folded"))).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: translate("zh", "report.firsts.open") }));
    expect(screen.getByText(translate("zh", "report.firsts.lastCall"))).toBeInTheDocument();
  });
});
