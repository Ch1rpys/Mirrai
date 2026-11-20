// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

/**
 * The mirror (C4.1).
 *
 * Five blocks, each about the user's own side; a block with no
 * measurement is not shown, and every example points back at the line it
 * came from. There is no "you should" anywhere.
 */
const navigate = vi.fn();
let mirror: any = null;

vi.mock("@/lib/trpc", () => ({
  trpc: {
    persona: {
      get: { useQuery: () => ({ data: { id: 5, name: "小满" }, isLoading: false, isError: false, refetch: vi.fn() }) },
    },
    style: {
      get: { useQuery: () => ({ data: { profile: { mirror } }, isLoading: false, isError: false, refetch: vi.fn() }) },
    },
  },
}));

vi.mock("wouter", () => ({
  useParams: () => ({ id: "5" }),
  useLocation: () => ["/persona/5/mirror", navigate],
}));

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

import Mirror from "./Mirror";

const full = {
  shortReplies: [
    { text: "嗯", n: 6, nextState: { distant: 6 }, nextGapMedianSec: 3600, exampleIds: [12, 13] },
  ],
  goingShort: { episodes: 2, byBand: { evening: 2 }, exampleIds: [21] },
  myDelay: {
    samples: 60,
    resolution: "second",
    buckets: {
      evening: { n: 40, mu: Math.log(40), sigma: 0.8 },
      all: { n: 60, mu: Math.log(45), sigma: 0.8 },
    },
  },
  myDelayExampleIds: [31],
  repairBy: { me: 2, them: 4 },
  repairExampleIds: [41, 42],
  starts: { me: 80, them: 80 },
  startExampleIds: [51, 52],
};

describe("the mirror", () => {
  it("shows the five blocks", () => {
    mirror = full;
    render(<Mirror />);
    expect(screen.getByText("你常回的短句")).toBeInTheDocument();
    expect(screen.getByText("你也有突然变短的时候")).toBeInTheDocument();
    expect(screen.getByText("你回消息的快慢")).toBeInTheDocument();
    expect(screen.getByText("吵架之后先开口的")).toBeInTheDocument();
    expect(screen.getByText("每个场景谁先开口")).toBeInTheDocument();
    expect(screen.getByText(/你回「嗯」有 6 次。其中 6 次之后，小满 的话变少了。/)).toBeInTheDocument();
    expect(screen.getByText(/你 2 次，小满 4 次/)).toBeInTheDocument();
  });

  it("gives every block an example list", () => {
    mirror = full;
    render(<Mirror />);
    expect(screen.getAllByRole("button", { name: translate("zh", "mirror.example") }).length)
      .toBeGreaterThanOrEqual(5);
  });

  it("points an example back at the record line", async () => {
    mirror = full;
    const user = userEvent.setup();
    render(<Mirror />);
    await user.click(screen.getAllByRole("button", { name: translate("zh", "mirror.example") })[0]);
    expect(navigate).toHaveBeenCalledWith("/persona/5/records?at=12");
  });

  it("does not show a block it could not measure", () => {
    mirror = { shortReplies: [], goingShort: { episodes: 0, byBand: {}, exampleIds: [] }, myDelay: null, myDelayExampleIds: [], repairBy: null, repairExampleIds: [], starts: { me: 3, them: 4 }, startExampleIds: [] };
    render(<Mirror />);
    expect(screen.getByText("每个场景谁先开口")).toBeInTheDocument();
    expect(screen.queryByText("你常回的短句")).toBeNull();
    expect(screen.queryByText("你回消息的快慢")).toBeNull();
    expect(screen.queryByText("吵架之后先开口的")).toBeNull();
  });

  it("says when the record is too thin", () => {
    mirror = null;
    render(<Mirror />);
    expect(screen.getByText(translate("zh", "mirror.empty"))).toBeInTheDocument();
  });
});
