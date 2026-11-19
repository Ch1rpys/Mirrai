// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { translate } from "@/i18n";

const voiceInfo = vi.fn();

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
    chat: {
      voices: {
        useQuery: () => voiceInfo(),
      },
    },
  },
}));

import TtsNote from "./TtsNote";

describe("where the read-aloud runs", () => {
  it("says the text goes to Microsoft when the online voice is in use", () => {
    voiceInfo.mockReturnValue({
      data: { enabled: true, engine: "edge", leavesMachine: true, voices: [] },
    });
    render(<TtsNote />);
    expect(screen.getByText(translate("zh", "localFirst.ttsTitle"))).toBeInTheDocument();
    expect(
      screen.getByText(translate("zh", "localFirst.ttsNote")),
    ).toHaveTextContent("微软");
  });

  it("says it is synthesised here when a local engine is configured", () => {
    voiceInfo.mockReturnValue({
      data: { enabled: true, engine: "piper", leavesMachine: false, voices: [] },
    });
    render(<TtsNote />);
    const note = screen.getByText(translate("zh", "localFirst.ttsLocalNote"));
    expect(note).toBeInTheDocument();
    expect(screen.queryByText(/微软/)).toBeNull();
  });

  it("says the read-aloud is off rather than promising a voice", () => {
    voiceInfo.mockReturnValue({
      data: { enabled: false, engine: "off", leavesMachine: false, voices: [] },
    });
    render(<TtsNote />);
    expect(screen.getByText(translate("zh", "localFirst.ttsOffNote"))).toBeInTheDocument();
    expect(screen.queryByText(/微软/)).toBeNull();
  });

  it("does not claim anything before the engine is known", () => {
    voiceInfo.mockReturnValue({ data: undefined });
    const { container } = render(<TtsNote />);
    expect(container).toBeEmptyDOMElement();
  });
});
