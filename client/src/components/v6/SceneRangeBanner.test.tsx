// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { translate } from "@/i18n";
import { formatDayKey } from "@/lib/dates";

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

import SceneRangeBanner from "./SceneRangeBanner";

const RANGE_SCENE = {
  id: 30,
  name: "2026-03-01–2026-03-02",
  recordRange: {
    personaId: 5,
    fromId: 100,
    toId: 107,
    from: "2026-03-01",
    to: "2026-03-02",
  },
};

describe("the scene-range banner", () => {
  it("says which days the conversation is set in, and what the persona does not know", () => {
    render(<SceneRangeBanner scene={RANGE_SCENE} personaId={5} personaName="小A" />);

    const from = formatDayKey("2026-03-01", "zh");
    const to = formatDayKey("2026-03-02", "zh");
    const expected = translate("zh", "chat.sceneRangeBanner", { from, to, name: "小A" });
    expect(screen.getByTestId("scene-range-banner").textContent).toBe(expected);
    // The manual's wording, verbatim.
    expect(expected).toContain("正在按");
    expect(expected).toContain("那几天的语境聊");
    expect(expected).toContain("那之后的事，小A 不知道。");
  });

  it("says nothing when the active scene is an ordinary one", () => {
    render(
      <SceneRangeBanner
        scene={{ recordRange: null }}
        personaId={5}
        personaName="小A"
      />,
    );
    expect(screen.queryByTestId("scene-range-banner")).toBeNull();
  });

  it("says nothing when there is no scene at all", () => {
    render(<SceneRangeBanner scene={null} personaId={5} personaName="小A" />);
    expect(screen.queryByTestId("scene-range-banner")).toBeNull();
  });

  it("says nothing for a scene taken from another persona's record", () => {
    render(
      <SceneRangeBanner
        scene={{ ...RANGE_SCENE, recordRange: { ...RANGE_SCENE.recordRange, personaId: 6 } }}
        personaId={5}
        personaName="小A"
      />,
    );
    expect(screen.queryByTestId("scene-range-banner")).toBeNull();
  });
});
