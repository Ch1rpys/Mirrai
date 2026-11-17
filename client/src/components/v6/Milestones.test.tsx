// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { translate } from "@/i18n";
import { formatInstantInZone } from "@/lib/dates";

let data: {
  firstLetterAt: string | null;
  firstOutboundSentAt: string | null;
  firstFarewellAt: string | null;
} | undefined;
let isLoading = false;
let isError = false;

vi.mock("@/lib/trpc", () => ({
  trpc: {
    user: {
      milestones: {
        useQuery: () => ({ data, isLoading, isError }),
      },
    },
  },
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { timezone: "Asia/Shanghai" },
    isAuthenticated: true,
    loading: false,
  }),
}));

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

import Milestones from "./Milestones";

const LETTER_AT = "2024-06-15T08:00:00.000Z";
const OUTBOUND_AT = "2024-07-01T10:00:00.000Z";
const FAREWELL_AT = "2024-08-20T12:00:00.000Z";

describe("the milestones that are not about how much someone chatted", () => {
  beforeEach(() => {
    data = {
      firstLetterAt: null,
      firstOutboundSentAt: null,
      firstFarewellAt: null,
    };
    isLoading = false;
    isError = false;
  });

  it("renders nothing when none of the three has happened", () => {
    const { container } = render(<Milestones />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows only the one that has a date", () => {
    data = {
      firstLetterAt: LETTER_AT,
      firstOutboundSentAt: null,
      firstFarewellAt: null,
    };

    render(<Milestones />);

    expect(screen.getByText("走到这里")).toBeInTheDocument();
    expect(screen.getByText(/写下了第一封信/)).toHaveTextContent(
      formatInstantInZone(LETTER_AT, "zh", "Asia/Shanghai"),
    );
    expect(screen.queryByText(/把一句话带回/)).toBeNull();
    expect(screen.queryByText(/好好说了一次再见/)).toBeNull();
  });

  it("lists every date that has happened", () => {
    data = {
      firstLetterAt: LETTER_AT,
      firstOutboundSentAt: OUTBOUND_AT,
      firstFarewellAt: FAREWELL_AT,
    };

    render(<Milestones />);

    expect(screen.getByText(/把一句话带回给了 TA 本人/)).toHaveTextContent(
      formatInstantInZone(OUTBOUND_AT, "zh", "Asia/Shanghai"),
    );
    expect(screen.getByText(/好好说了一次再见/)).toHaveTextContent(
      formatInstantInZone(FAREWELL_AT, "zh", "Asia/Shanghai"),
    );
  });
});
