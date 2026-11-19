// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { translate } from "@/i18n";

const listPhotos = vi.fn();

vi.mock("@/lib/trpc", () => ({
  trpc: {
    media: {
      listPhotos: { useQuery: () => listPhotos() },
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

import PhotoTimeline from "./PhotoTimeline";

describe("the photo timeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("groups the photos by month and opens one", () => {
    listPhotos.mockReturnValue({
      data: {
        photos: [
          { id: 1, url: "/uploads/1.jpg", at: "2022-04-02T04:00:00Z", width: 4, height: 4 },
          { id: 2, url: "/uploads/2.jpg", at: "2022-04-03T04:00:00Z", width: 4, height: 4 },
          { id: 3, url: "/uploads/3.jpg", at: "2022-05-03T04:00:00Z", width: 4, height: 4 },
        ],
        total: 3,
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    const { container } = render(<PhotoTimeline personaId={5} name="小满" />);
    expect(container.querySelectorAll("img")).toHaveLength(3);
    expect(screen.getByText("2022年4月")).toBeInTheDocument();
    expect(screen.getByText("2022年5月")).toBeInTheDocument();
  });

  it("shows the empty state when there are no photos", () => {
    listPhotos.mockReturnValue({
      data: { photos: [], total: 0 },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    render(<PhotoTimeline personaId={5} name="小满" />);
    expect(screen.getByText(translate("zh", "photos.empty"))).toBeInTheDocument();
  });

  it("gives a retry when the album failed", () => {
    const refetch = vi.fn();
    listPhotos.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    });
    render(<PhotoTimeline personaId={5} name="小满" />);
    expect(screen.getByText(translate("zh", "common.retry"))).toBeInTheDocument();
  });
});
