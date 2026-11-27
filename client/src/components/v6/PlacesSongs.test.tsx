// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

const placesState: { value: any } = { value: undefined };
const songsState: { value: any } = { value: undefined };
const tileLayer = vi.fn(() => ({ addTo: vi.fn() }));
const map = vi.fn(() => ({ setView: () => ({}) }));

vi.mock("leaflet", () => ({
  default: {
    map: () => {
      map();
      const instance = { setView: () => instance, tile: undefined as unknown };
      return instance;
    },
    tileLayer: () => {
      tileLayer();
      return { addTo: vi.fn() };
    },
    marker: () => ({ addTo: () => ({ bindPopup: () => ({}) }) }),
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

vi.mock("@/lib/trpc", () => ({
  trpc: {
    record: {
      places: { useQuery: () => placesState.value },
      songs: { useQuery: () => songsState.value },
    },
  },
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 1, timezone: "Asia/Shanghai" } }),
}));

import { PlacesPanel, SongsPanel } from "./PlacesSongs";

const place = {
  name: "拾光咖啡",
  lat: 31.2303,
  lng: 121.4739,
  count: 2,
  first: "2022-03-01T12:00:00.000Z",
  last: "2022-03-02T12:00:00.000Z",
  samples: [
    { recordId: 11, at: "2022-03-01T12:00:00.000Z" },
    { mediaId: 9, url: "/uploads/personas/1/5/a.jpg", at: "2022-03-02T12:00:00.000Z" },
  ],
};

describe("the places panel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    placesState.value = {
      data: { places: [place], tileUrl: null },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
  });

  it("shows the places and draws the points without a basemap", async () => {
    render(<PlacesPanel personaId={5} />);
    expect(screen.getByText("拾光咖啡")).toBeInTheDocument();
    expect(screen.getByText(/最近一次/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "2022-03-01" })).toHaveAttribute(
      "href",
      "/persona/5/records?at=11",
    );
    expect(screen.getByRole("link", { name: "2022-03-02" })).toHaveAttribute(
      "href",
      "/uploads/personas/1/5/a.jpg",
    );
    expect(screen.queryByLabelText(translate("zh", "report.places.mapToggle"))).not.toBeInTheDocument();
    await waitFor(() => expect(map).toHaveBeenCalled());
    expect(tileLayer).not.toHaveBeenCalled();
  });

  it("offers the basemap only when the operator configured one, and keeps it off", async () => {
    placesState.value = {
      data: { places: [place], tileUrl: "https://tiles.example.com/{z}/{x}/{y}.png" },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
    render(<PlacesPanel personaId={5} />);
    const toggle = screen.getByLabelText(translate("zh", "report.places.mapToggle"));
    expect(toggle).not.toBeChecked();
    expect(screen.getByText(/tiles\.example\.com/)).toBeInTheDocument();
    await userEvent.click(toggle);
    await waitFor(() => expect(tileLayer).toHaveBeenCalled());
  });

  it("shows the empty state rather than an empty map", () => {
    placesState.value = {
      data: { places: [], tileUrl: null },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
    render(<PlacesPanel personaId={5} />);
    expect(screen.getByText(translate("zh", "report.places.empty"))).toBeInTheDocument();
  });
});

describe("the songs panel", () => {
  it("links only the http(s) songs", () => {
    songsState.value = {
      data: [
        { title: "晴天", artist: "周杰伦", url: "https://example.com/song", count: 2, first: "2022-03-01T12:00:00.000Z", sharedByMe: 1, sharedByThem: 1 },
        { title: "危险", artist: "某人", url: "javascript:alert(1)", count: 1, first: "2022-03-02T12:00:00.000Z", sharedByMe: 1, sharedByThem: 0 },
      ],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
    render(<SongsPanel personaId={5} />);
    expect(screen.getByRole("link", { name: "晴天" }).getAttribute("href")).toBe("https://example.com/song");
    expect(screen.queryByRole("link", { name: "危险" })).not.toBeInTheDocument();
    expect(screen.getByText("危险")).toBeInTheDocument();
  });

  it("shows the empty state", () => {
    songsState.value = { data: [], isLoading: false, isError: false, refetch: vi.fn() };
    render(<SongsPanel personaId={5} />);
    expect(screen.getByText(translate("zh", "report.songs.empty"))).toBeInTheDocument();
  });
});
