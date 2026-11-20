// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { translate } from "@/i18n";

const updateSettings = vi.fn();
const searchCity = vi.fn();
let stored: any = { ldr: { nextMeetAt: "2026-03-04", weather: false } };
let searchResults: any[] = [];
let weatherFeatureEnabled = true;

vi.mock("@/lib/trpc", () => ({
  trpc: {
    ldr: {
      status: { useQuery: () => ({ data: { enabled: weatherFeatureEnabled } }) },
      searchCity: {
        useMutation: (options?: { onSuccess?: (data: any) => void }) => ({
          mutate: (input: unknown) => {
            searchCity(input);
            options?.onSuccess?.({ results: searchResults });
          },
          isPending: false,
        }),
      },
    },
    persona: {
      getSettings: {
        useQuery: () => ({ data: stored, isLoading: false, refetch: vi.fn() }),
      },
      updateSettings: {
        useMutation: (options?: { onSuccess?: () => void }) => ({
          mutate: (input: unknown, callOptions?: { onSuccess?: () => void }) => {
            if (callOptions) updateSettings(input, callOptions);
            else updateSettings(input);
            options?.onSuccess?.();
            callOptions?.onSuccess?.();
          },
          isPending: false,
        }),
      },
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

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import LdrSettings from "./LdrSettings";

describe("the long-distance settings (C5.1, C5.2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stored = { ldr: { nextMeetAt: "2026-03-04", weather: false } };
    searchResults = [];
    weatherFeatureEnabled = true;
  });

  it("shows the saved meeting day and saves a new one", () => {
    render(<LdrSettings personaId={5} />);
    const input = screen.getByLabelText("下次见面") as HTMLInputElement;
    expect(input.value).toBe("2026-03-04");
    fireEvent.change(input, { target: { value: "2026-04-01" } });
    fireEvent.click(screen.getByRole("button", { name: "记下这个日子" }));
    expect(updateSettings).toHaveBeenCalledWith(
      { id: 5, patch: { ldr: { nextMeetAt: "2026-04-01" } } },
      expect.anything(),
    );
  });

  it("clears the day", () => {
    render(<LdrSettings personaId={5} />);
    fireEvent.click(screen.getByRole("button", { name: "清掉这个日子" }));
    expect(updateSettings).toHaveBeenCalledWith(
      { id: 5, patch: { ldr: { nextMeetAt: null } } },
      expect.anything(),
    );
  });

  it("searches for a city only on the button, and saves the chosen one", () => {
    searchResults = [
      {
        name: "柏林",
        latitude: 52.52437,
        longitude: 13.41053,
        country: "德国",
        timezone: "Europe/Berlin",
      },
    ];
    render(<LdrSettings personaId={5} name="小满" />);
    expect(searchCity).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("TA 所在的城市"), { target: { value: "柏林" } });
    fireEvent.click(screen.getByRole("button", { name: "查找" }));
    expect(searchCity).toHaveBeenCalledWith({ name: "柏林" });
    fireEvent.click(screen.getByRole("button", { name: "用这个" }));
    expect(updateSettings).toHaveBeenCalledWith(
      {
        id: 5,
        patch: {
          ldr: {
            city: {
              name: "柏林",
              lat: 52.52437,
              lng: 13.41053,
              timezone: "Europe/Berlin",
            },
          },
        },
      },
      expect.anything(),
    );
  });

  it("says when a search found nothing", () => {
    render(<LdrSettings personaId={5} />);
    fireEvent.change(screen.getByLabelText("TA 所在的城市"), { target: { value: "不存在" } });
    fireEvent.click(screen.getByRole("button", { name: "查找" }));
    expect(screen.getByText("没有找到这个城市。")).toBeInTheDocument();
  });

  it("has no city or weather entry when the operator switched the feature off", () => {
    weatherFeatureEnabled = false;
    render(<LdrSettings personaId={5} name="小满" />);
    expect(screen.getByLabelText("下次见面")).toBeInTheDocument();
    expect(screen.queryByLabelText("TA 所在的城市")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("shows the weather switch for a saved city and sends it", () => {
    stored = {
      ldr: {
        nextMeetAt: null,
        weather: false,
        city: { name: "上海", lat: 31.2304, lng: 121.4737, timezone: "Asia/Shanghai" },
      },
    };
    render(<LdrSettings personaId={5} name="小满" />);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(updateSettings).toHaveBeenCalledWith({ id: 5, patch: { ldr: { weather: true } } });
  });
});
