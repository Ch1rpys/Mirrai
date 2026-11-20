// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { translate } from "@/i18n";
import { sunTimes } from "@shared/sun";

let enabled = true;
let weatherData: any = {
  city: "上海",
  temperature: 10.6,
  weatherCode: 0,
  isDay: true,
  timezone: "Asia/Shanghai",
};

vi.mock("@/lib/trpc", () => ({
  trpc: {
    ldr: {
      status: { useQuery: () => ({ data: { enabled }, isError: false }) },
      weather: { useQuery: () => ({ data: weatherData, isError: false }) },
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

import TheirSide, { weatherGroup } from "./TheirSide";

const CITY = { name: "上海", lat: 31.2304, lng: 121.4737, timezone: "Asia/Shanghai" };

function clock(iso: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(iso);
}

describe("the weather on their side (C5.2)", () => {
  beforeEach(() => {
    enabled = true;
    weatherData = {
      city: "上海",
      temperature: 10.6,
      weatherCode: 0,
      isDay: true,
      timezone: "Asia/Shanghai",
    };
  });

  it("shows the city, the weather, the temperature and the next light", () => {
    // Noon in Shanghai: the sunset is still ahead.
    const at = new Date("2026-03-01T04:00:00Z");
    const sun = sunTimes("2026-03-01", CITY.lat, CITY.lng)!;
    render(
      <TheirSide
        personaId={5}
        settings={{ ldr: { weather: true, city: CITY } }}
        timezone="Asia/Shanghai"
        now={at}
      />,
    );
    expect(
      screen.getByText(`上海 · 晴 11° · 日落 ${clock(sun.sunset)}`),
    ).toBeInTheDocument();
  });

  it("moves on to tomorrow's sunrise after sunset", () => {
    // Nine in the evening in Shanghai.
    const at = new Date("2026-03-01T13:00:00Z");
    const sun = sunTimes("2026-03-02", CITY.lat, CITY.lng)!;
    render(
      <TheirSide
        personaId={5}
        settings={{ ldr: { weather: true, city: CITY } }}
        timezone="Asia/Shanghai"
        now={at}
      />,
    );
    expect(screen.getByText(new RegExp(`日出 ${clock(sun.sunrise)}`))).toBeInTheDocument();
  });

  it("renders nothing when the switch is off, the city is missing, or the request failed", () => {
    const { container, unmount } = render(
      <TheirSide personaId={5} settings={{ ldr: { weather: false, city: CITY } }} />,
    );
    expect(container).toBeEmptyDOMElement();
    unmount();
    const second = render(
      <TheirSide personaId={5} settings={{ ldr: { weather: true } }} />,
    );
    expect(second.container).toBeEmptyDOMElement();
    second.unmount();
    weatherData = null;
    const third = render(
      <TheirSide personaId={5} settings={{ ldr: { weather: true, city: CITY } }} />,
    );
    expect(third.container).toBeEmptyDOMElement();
  });

  it("renders nothing when the operator switched the weather off", () => {
    enabled = false;
    const { container } = render(
      <TheirSide personaId={5} settings={{ ldr: { weather: true, city: CITY } }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("names the weather groups it knows", () => {
    expect(weatherGroup(0)).toBe("clear");
    expect(weatherGroup(2)).toBe("partly");
    expect(weatherGroup(61)).toBe("rain");
    expect(weatherGroup(75)).toBe("snow");
    expect(weatherGroup(95)).toBe("storm");
    expect(weatherGroup(1234)).toBe("unknown");
  });
});
