// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";
import { emptyEvidenceByDimension, type EvidenceByDimension } from "@shared/evidence-map";
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 1, timezone: "Asia/Shanghai" } }),
}));

import EvidenceList from "./EvidenceList";

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

const withHabit: EvidenceByDimension = {
  ...emptyEvidenceByDimension(),
  habit: [
    {
      claim: "短句",
      periodId: "p2",
      quotes: [{
        recordId: 7,
        at: "2023-07-12T08:16:09.000Z",
        speaker: "小满",
        text: "在的呀",
      }],
    },
  ],
};

describe("the evidence under a portrait layer", () => {
  it("shows how many cards a layer has and expands them", async () => {
    const user = userEvent.setup();
    render(
      <EvidenceList field="speakingStyle" dimensions={withHabit} personaId={5} />,
    );
    const toggle = screen.getByRole("button", {
      name: translate("zh", "evidence.toggle", { count: 1 }),
    });
    expect(screen.queryByText("短句")).toBeNull();
    await user.click(toggle);
    expect(screen.getByText("短句")).toBeInTheDocument();
    expect(screen.getByText(/在的呀/)).toBeInTheDocument();
  });

  it("links a quoted line to its row in the record reader (B7.3)", async () => {
    const user = userEvent.setup();
    render(
      <EvidenceList field="speakingStyle" dimensions={withHabit} personaId={5} />,
    );
    await user.click(
      screen.getByRole("button", {
        name: translate("zh", "evidence.toggle", { count: 1 }),
      }),
    );
    // The quoted words are still the visible text; they now open the
    // reader on the row they came from (C2.10's `?at=`).
    const link = screen.getByText("在的呀").closest("a");
    expect(link).toHaveAttribute("href", "/persona/5/records?at=7");
  });

  it("always marks attachment style as inferred", () => {
    render(
      <EvidenceList field="attachmentStyle" dimensions={withHabit} personaId={5} />,
    );
    expect(screen.getByText(translate("zh", "evidence.inferred"))).toBeInTheDocument();
    expect(screen.getByText(translate("zh", "evidence.inferred"))).toHaveAttribute(
      "title",
      translate("zh", "evidence.inferredHint"),
    );
    expect(screen.queryByRole("button")).toBeNull();
  });
});
