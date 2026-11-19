// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

const capabilities = vi.fn();
const photos = vi.fn();
const upload = vi.fn();
const clear = vi.fn();
const faceApi = vi.hoisted(() => ({ loaded: false }));

vi.mock("@vladmandic/face-api", () => {
  faceApi.loaded = true;
  return {
    nets: {
      tinyFaceDetector: { loadFromUri: vi.fn() },
      faceLandmark68Net: { loadFromUri: vi.fn() },
      faceRecognitionNet: { loadFromUri: vi.fn() },
    },
  };
});

vi.mock("@/lib/trpc", () => ({
  trpc: {
    media: {
      capabilities: { useQuery: () => capabilities() },
      listPhotos: { useQuery: () => photos() },
    },
    persona: {
      uploadAvatar: { useMutation: () => ({ mutate: upload, isPending: false }) },
      clearAvatar: { useMutation: () => ({ mutate: clear, isPending: false }) },
    },
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

import AvatarPicker from "./AvatarPicker";

const album = {
  data: {
    photos: [
      { id: 1, url: "/uploads/personas/1/5/a.jpg", at: "2022-04-02T04:00:00Z", width: 4, height: 4 },
    ],
    total: 1,
  },
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
};

describe("the avatar picker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capabilities.mockReturnValue({ data: { faceModels: false }, isLoading: false });
    photos.mockReturnValue(album);
  });

  it("shows the current avatar and the album", () => {
    render(
      <AvatarPicker personaId={5} name="小满" avatarUrl="/uploads/personas/1/5/old.png" />,
    );
    expect(screen.getByAltText(translate("zh", "avatar.current", { name: "小满" }))).toHaveAttribute(
      "src",
      "/uploads/personas/1/5/old.png",
    );
    expect(screen.getByText(translate("zh", "avatar.fromAlbum"))).toBeInTheDocument();
  });

  it("does not offer the face grouping when the weights are not on this machine", () => {
    render(<AvatarPicker personaId={5} name="小满" avatarUrl={null} />);
    expect(
      screen.queryByText(translate("zh", "avatar.faceButton", { name: "小满" })),
    ).not.toBeInTheDocument();
  });

  it("does not load the face model just by rendering the picker", () => {
    render(<AvatarPicker personaId={5} name="小满" avatarUrl={null} />);
    expect(faceApi.loaded).toBe(false);
  });

  it("opens a chosen album photo in the crop stage", async () => {
    const user = userEvent.setup();
    render(<AvatarPicker personaId={5} name="小满" avatarUrl={null} />);
    const [photo] = screen.getAllByTitle(translate("zh", "avatar.usePhoto"));
    await user.click(photo!);
    expect(screen.getByAltText(translate("zh", "avatar.cropAlt"))).toBeInTheDocument();
    expect(screen.getByText(translate("zh", "avatar.dragHint"))).toBeInTheDocument();
  });

  it("clears the avatar", async () => {
    const user = userEvent.setup();
    render(
      <AvatarPicker personaId={5} name="小满" avatarUrl="/uploads/personas/1/5/old.png" />,
    );
    await user.click(screen.getByText(translate("zh", "avatar.remove")));
    expect(clear).toHaveBeenCalledWith({ personaId: 5 });
  });

  it("says the album failed instead of showing an empty one", () => {
    photos.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: vi.fn(),
    });
    render(<AvatarPicker personaId={5} name="小满" avatarUrl={null} />);
    expect(screen.getByText(new RegExp(translate("zh", "avatar.albumFailed")))).toBeInTheDocument();
  });
});
