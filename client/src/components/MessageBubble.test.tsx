// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";
import { formatInstantInZone } from "@/lib/dates";

/**
 * The message bubble.
 *
 * A message is the user's own. Being able to copy it, quote it, fix it,
 * repeat it and remove it is what makes a conversation a conversation rather
 * than a transcript — and none of that was tested, because the component
 * used to live inside a two-thousand-line page where it could not be
 * reached.
 *
 * What is worth testing here is the behaviour a person can see: which
 * buttons a message has (they are not the same for the two sides), that
 * editing hands back the new text and can be abandoned, and that the
 * persona's side can be repeated while the user's side cannot.
 */
const markUnlike = vi.fn();

vi.mock("@/lib/trpc", () => ({
  trpc: {
    chat: {
      tts: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      voices: { useQuery: () => ({ data: { voices: [] } }) },
    },
    fidelity: {
      mark: {
        useMutation: (opts?: any) => ({
          mutate: (input: any) => {
            markUnlike(input);
            opts?.onSuccess?.({ id: 1 });
          },
          isPending: false,
        }),
      },
    },
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// The markdown renderer pulls in a stylesheet, which the test environment
// cannot load. The bubble only needs it to render the persona's words, so
// it is stood in for.
//
// The plugin chain is exported as well, because the safe chain is built
// from it — see `client/src/lib/safe-markdown.ts`.
vi.mock("streamdown", () => ({
  Streamdown: ({ children }: { children?: unknown }) => <div>{children as any}</div>,
  defaultRehypePlugins: { harden: {}, raw: {}, katex: {} },
}));

// The real dictionary, so a missing key fails the test rather than
// rendering an empty label.
/** The language the interface is read in. */
let locale: "zh" | "en" = "zh";

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate(locale, key, params),
    locale,
    localeName: locale === "en" ? "English" : "中文",
    setLocale: () => {},
  }),
}));

/**
 * The user's own clock.
 *
 * The times on the messages were the browser's — so on a machine whose
 * zone is not the user's, every message carried a different time from
 * the dates around it.
 */
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: 1, timezone: "America/New_York" },
    isAuthenticated: true,
    loading: false,
    logout: vi.fn(),
  }),
}));

import { MessageBubble, type Message } from "./MessageBubble";

/** A message, in the shape the chat page builds it. */
function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 1,
    role: "assistant",
    content: "在的。",
    createdAt: new Date("2026-01-02T03:04:00Z"),
    ...overrides,
  };
}

/** Every callback, so a test can assert on the one it cares about. */
function callbacks() {
  return {
    onRegenerate: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onQuote: vi.fn(),
  };
}

describe("the message bubble", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    locale = "zh";
  });

  it("does not show a picture's placeholder from another language", () => {
    /**
     * The picture's own text is a placeholder — "[图片]" — and it was
     * compared with the *current* language's copy of it. So a person
     * who sent a picture in Chinese and then changed the interface to
     * English saw "[图片]" under their own picture, in an English
     * conversation.
     */
    locale = "en";

    render(
      <MessageBubble
        msg={makeMessage({
          role: "user",
          content: "[图片]",
          messageType: "image",
          mediaUrl: "/uploads/chat/1/2/a.png",
        })}
        personaName="小A"
        showMood={false}
      />,
    );

    expect(screen.queryByText("[图片]")).toBeNull();
  });

  it("renders a sticker as a picture when it has one, and as a name when it does not", () => {
    const { unmount } = render(
      <MessageBubble
        msg={makeMessage({
          kind: "sticker",
          content: "[sticker:狗狗探头]",
          mediaUrl: "/uploads/personas/1/2/stickers/abc.png",
        })}
        personaName="小A"
        showMood={false}
      />,
    );
    expect(screen.getByAltText("［表情：狗狗探头］")).toHaveAttribute(
      "src",
      "/uploads/personas/1/2/stickers/abc.png",
    );
    unmount();

    render(
      <MessageBubble
        msg={makeMessage({ kind: "sticker", content: "[sticker:猫猫叹气]" })}
        personaName="小A"
        showMood={false}
      />,
    );
    expect(screen.getByText("［表情：猫猫叹气］")).toBeInTheDocument();
  });

  it("says a voice note is synthesised, and shows its words on request", async () => {
    const user = userEvent.setup();
    render(
      <MessageBubble
        msg={makeMessage({
          messageType: "voice",
          mediaUrl: "/uploads/tts/1/voice.mp3",
          mediaDuration: 4,
          content: "在的呀",
          kind: "voice-note",
        })}
        personaName="小A"
        showMood={false}
      />,
    );
    expect(screen.getByText(translate("zh", "chat.synthVoice"))).toBeInTheDocument();
    expect(screen.queryByText("在的呀")).toBeNull();
    await user.click(screen.getByText(translate("zh", "chat.showTranscript")));
    expect(screen.getByText("在的呀")).toBeInTheDocument();
  });

  it("does not call the user's own voice note synthesised", () => {
    render(
      <MessageBubble
        msg={makeMessage({
          role: "user",
          messageType: "voice",
          mediaUrl: "/uploads/chat/1/voice.webm",
          content: "我说的",
        })}
        personaName="小A"
        showMood={false}
      />,
    );
    expect(screen.queryByText(translate("zh", "chat.synthVoice"))).toBeNull();
    expect(screen.getByText(translate("zh", "chat.showTranscript"))).toBeInTheDocument();
  });

  it("does not offer to read a sticker aloud", () => {
    render(
      <MessageBubble
        msg={makeMessage({ kind: "sticker", content: "[sticker:狗狗探头]" })}
        personaName="小A"
        showMood={false}
      />,
    );
    expect(screen.queryByLabelText(translate("zh", "chat.tts"))).toBeNull();
  });

  it("shows the time in the user's own clock", () => {
    /**
     * Ten at night in New York is three in the morning there, and two
     * in the afternoon in Shanghai.
     */
    render(
      <MessageBubble
        msg={makeMessage({ createdAt: new Date("2026-01-02T03:04:00Z") })}
        personaName="小A"
        showMood={false}
      />,
    );
    // The interface is in Chinese here, so the clock is a 24-hour one.
    expect(screen.getByText("22:04")).toBeInTheDocument();
  });

  it("marks a reply that used a remembered weekly window", () => {
    render(
      <MessageBubble
        msg={makeMessage({ routine: "r1" })}
        personaName="小A"
        showMood={false}
      />,
    );
    expect(screen.getByText(translate("zh", "chat.routineMarker"))).toBeInTheDocument();
  });

  it("shows what was said", () => {
    render(
      <MessageBubble msg={makeMessage({ content: "今天过得怎么样？" })} personaName="小A" showMood={false} />,
    );
    expect(screen.getByText("今天过得怎么样？")).toBeInTheDocument();
  });

  it("copies the message", async () => {
    const user = userEvent.setup();
    // `userEvent.setup()` installs its own clipboard stub, so the mock has
    // to go in afterwards. `navigator.clipboard` is a read-only property in
    // jsdom, so it has to be defined rather than assigned.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    render(
      <MessageBubble msg={makeMessage({ content: "在的。" })} personaName="小A" showMood={false} />,
    );
    await user.click(screen.getByLabelText(translate("zh", "chat.copy")));

    expect(writeText).toHaveBeenCalledWith("在的。");
  });

  it("quotes the message", async () => {
    const user = userEvent.setup();
    const handlers = callbacks();

    render(
      <MessageBubble
        msg={makeMessage()}
        personaName="小A"
        showMood={false}
        onQuote={handlers.onQuote}
      />,
    );
    await user.click(screen.getByLabelText(translate("zh", "chat.quote")));

    expect(handlers.onQuote).toHaveBeenCalled();
  });

  it("offers to repeat the persona's reply, and not the user's", () => {
    const handlers = callbacks();

    const { unmount } = render(
      <MessageBubble
        msg={makeMessage({ role: "assistant" })}
        personaName="小A"
        showMood={false}
        onRegenerate={handlers.onRegenerate}
      />,
    );
    expect(screen.getByLabelText(translate("zh", "chat.regenerate"))).toBeInTheDocument();
    unmount();

    render(
      <MessageBubble
        msg={makeMessage({ role: "user" })}
        personaName="小A"
        showMood={false}
        onRegenerate={handlers.onRegenerate}
      />,
    );
    expect(screen.queryByLabelText(translate("zh", "chat.regenerate"))).toBeNull();
  });

  it("offers to edit the user's own message, and not the persona's", () => {
    const handlers = callbacks();

    const { unmount } = render(
      <MessageBubble
        msg={makeMessage({ role: "user" })}
        personaName="小A"
        showMood={false}
        onEdit={handlers.onEdit}
      />,
    );
    expect(screen.getByLabelText(translate("zh", "chat.edit"))).toBeInTheDocument();
    unmount();

    render(
      <MessageBubble
        msg={makeMessage({ role: "assistant" })}
        personaName="小A"
        showMood={false}
        onEdit={handlers.onEdit}
      />,
    );
    expect(screen.queryByLabelText(translate("zh", "chat.edit"))).toBeNull();
  });

  it("hands back the edited text", async () => {
    const user = userEvent.setup();
    const handlers = callbacks();

    render(
      <MessageBubble
        msg={makeMessage({ role: "user", content: "在吗" })}
        personaName="小A"
        showMood={false}
        onEdit={handlers.onEdit}
      />,
    );

    await user.click(screen.getByLabelText(translate("zh", "chat.edit")));
    const box = screen.getByRole("textbox");
    await user.clear(box);
    await user.type(box, "在吗？");
    await user.click(screen.getByText(translate("zh", "common.save")));

    expect(handlers.onEdit).toHaveBeenCalledWith(
      expect.objectContaining({ content: "在吗" }),
      "在吗？",
    );
  });

  it("does not send the same edit twice", async () => {
    /**
     * The button was not disabled while the save was on its way: so a
     * double click sent the same edit twice.
     */
    const user = userEvent.setup();
    const releases: Array<() => void> = [];
    const onEdit = vi.fn(() => new Promise<void>((resolve) => { releases.push(resolve); }));

    render(
      <MessageBubble
        msg={makeMessage({ role: "user", content: "在吗" })}
        personaName="小A"
        showMood={false}
        onEdit={onEdit}
      />,
    );

    await user.click(screen.getByLabelText(translate("zh", "chat.edit")));
    const box = screen.getByRole("textbox");
    await user.clear(box);
    await user.type(box, "在吗？");

    const save = screen.getByText(translate("zh", "common.save")) as HTMLButtonElement;
    await user.click(save);
    // The second click lands while the first is still on its way.
    expect(save.disabled).toBe(true);
    await user.click(save);

    expect(onEdit).toHaveBeenCalledTimes(1);
    for (const release of releases) release();
  });

  it("gives up the edit when the user changes their mind", async () => {
    const user = userEvent.setup();
    const handlers = callbacks();

    render(
      <MessageBubble
        msg={makeMessage({ role: "user", content: "在吗" })}
        personaName="小A"
        showMood={false}
        onEdit={handlers.onEdit}
      />,
    );

    await user.click(screen.getByLabelText(translate("zh", "chat.edit")));
    await user.click(screen.getByText(translate("zh", "common.cancel")));

    expect(handlers.onEdit).not.toHaveBeenCalled();
    // The original text is back.
    expect(screen.getByText("在吗")).toBeInTheDocument();
  });

  it("will not save an edit that emptied the message", async () => {
    const user = userEvent.setup();
    const handlers = callbacks();

    render(
      <MessageBubble
        msg={makeMessage({ role: "user", content: "在吗" })}
        personaName="小A"
        showMood={false}
        onEdit={handlers.onEdit}
      />,
    );

    await user.click(screen.getByLabelText(translate("zh", "chat.edit")));
    await user.clear(screen.getByRole("textbox"));

    expect(screen.getByText(translate("zh", "common.save"))).toBeDisabled();
    expect(handlers.onEdit).not.toHaveBeenCalled();
  });

  it("removes the message", async () => {
    const user = userEvent.setup();
    const handlers = callbacks();

    render(
      <MessageBubble
        msg={makeMessage()}
        personaName="小A"
        showMood={false}
        onDelete={handlers.onDelete}
      />,
    );
    await user.click(screen.getByLabelText(translate("zh", "chat.delete")));

    expect(handlers.onDelete).toHaveBeenCalled();
  });

  it("shows what the message is quoting", () => {
    render(
      <MessageBubble
        msg={makeMessage({ replyToContent: "你昨天说的那家店" })}
        personaName="小A"
        showMood={false}
      />,
    );
    expect(screen.getByText("你昨天说的那家店")).toBeInTheDocument();
  });

  it("shows which memories were recalled", () => {
    render(
      <MessageBubble
        msg={makeMessage({
          recalled: [
            { id: 1, title: "你们第一次看的那部电影", subject: "them" },
            { id: 2, title: "她养的那只猫", subject: "them" },
          ],
        })}
        personaName="小A"
        showMood={false}
      />,
    );
    expect(screen.getByText(translate("zh", "chat.recalled", { count: 2 }))).toBeInTheDocument();
    // The memory is listed with a bullet in front of it.
    expect(screen.getByText(/你们第一次看的那部电影/)).toBeInTheDocument();
    expect(screen.getByText(/她养的那只猫/)).toBeInTheDocument();
  });

  it("shows the real photo a recalled memory carries", () => {
    const { container } = render(
      <MessageBubble
        msg={makeMessage({
          recalled: [
            {
              id: 1,
              title: "第一次见面",
              subject: "them",
              photo: {
                id: 11,
                url: "/uploads/personas/1/5/imports/1/a.jpg",
                at: "2022-04-02T04:00:00.000Z",
                width: 4,
                height: 4,
              },
            },
          ],
        })}
        personaName="小A"
        showMood={false}
      />,
    );
    const image = container.querySelector(
      'img[src="/uploads/personas/1/5/imports/1/a.jpg"]',
    );
    expect(image).not.toBeNull();
    expect(
      screen.getByText(formatInstantInZone("2022-04-02T04:00:00.000Z", "zh")),
    ).toBeInTheDocument();
  });

  it("says a photo is the real one the user uploaded, with its date", () => {
    render(
      <MessageBubble
        msg={makeMessage({
          content: "[image]",
          messageType: "image",
          mediaUrl: "/uploads/personas/1/5/imports/1/a.jpg",
          kind: "photo",
          photoAt: "2022-04-02T04:00:00.000Z",
        })}
        personaName="小A"
        showMood={false}
      />,
    );
    expect(screen.getByText(/这是你上传的真照片/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: translate("zh", "chat.imageAlt") })).toBeInTheDocument();
  });

  it("marks a supported claim and an unsupported one", () => {
    render(
      <MessageBubble
        msg={makeMessage({
          claims: [
            { text: "拾光咖啡", supported: true, date: "2022-03-12" },
            { text: "蓝湖餐厅", supported: false },
          ],
        })}
        personaName="小A"
        showMood={false}
      />,
    );
    expect(
      screen.getByText(translate("zh", "chat.claimSupported", { text: "拾光咖啡", date: "2022-03-12" })),
    ).toBeInTheDocument();
    expect(
      screen.getByText(translate("zh", "chat.claimUnsupported", { text: "蓝湖餐厅" })),
    ).toBeInTheDocument();
  });

  it("says where an ordinary-looking message really came from", () => {
    // A reply to a letter, and a message the persona started, look like
    // any other turn unless the bubble says so.
    const { unmount } = render(
      <MessageBubble
        msg={makeMessage({ role: "user", origin: "letter" })}
        personaName="小A"
        showMood={false}
      />,
    );
    expect(screen.getByText(translate("zh", "chat.letterSent"))).toBeInTheDocument();
    unmount();

    render(
      <MessageBubble
        msg={makeMessage({ role: "assistant", origin: "proactive" })}
        personaName="小A"
        showMood={false}
      />,
    );
    expect(screen.getByText(translate("zh", "chat.spokeFirst"))).toBeInTheDocument();
  });

  it("does not offer the actions while the message is still arriving", () => {
    render(
      <MessageBubble
        msg={makeMessage({ isStreaming: true, createdAt: undefined })}
        personaName="小A"
        showMood={false}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText(translate("zh", "chat.delete"))).toBeNull();
  });

  it("hides the three dots while a delay is still waiting in silence", () => {
    const { container } = render(
      <MessageBubble
        msg={makeMessage({ isStreaming: true, isTyping: false, content: "", createdAt: undefined })}
        personaName="小A"
        showMood={false}
      />,
    );
    expect(container.querySelector(".typing-dot")).toBeNull();
  });

  it("lets the reader mark a reply as unlike them", async () => {
    const user = userEvent.setup();
    render(
      <MessageBubble
        msg={makeMessage({ id: 9, role: "assistant" })}
        personaName="小A"
        showMood={false}
        personaId={3}
      />,
    );
    await user.click(screen.getByLabelText(translate("zh", "chat.unlike")));
    await user.click(screen.getByRole("menuitem", { name: translate("zh", "chat.unlikeReasons.word") }));
    expect(screen.getByPlaceholderText(translate("zh", "chat.unlikeRewritePlaceholder"))).toBeInTheDocument();
    expect(markUnlike).not.toHaveBeenCalled();
    fireEvent.pointerDown(document.body);
    expect(markUnlike).toHaveBeenCalledWith({ personaId: 3, messageId: 9, reason: "word" });
  });

  it("sends a rewrite with the unlike mark when the reader fills one in", async () => {
    const user = userEvent.setup();
    render(
      <MessageBubble
        msg={makeMessage({ id: 9, role: "assistant" })}
        personaName="小A"
        showMood={false}
        personaId={3}
      />,
    );
    await user.click(screen.getByLabelText(translate("zh", "chat.unlike")));
    await user.click(screen.getByRole("menuitem", { name: translate("zh", "chat.unlikeReasons.word") }));
    await user.type(
      screen.getByPlaceholderText(translate("zh", "chat.unlikeRewritePlaceholder")),
      "那才像",
    );
    await user.keyboard("{Enter}");
    expect(markUnlike).toHaveBeenCalledWith({
      personaId: 3,
      messageId: 9,
      reason: "word",
      rewrite: "那才像",
    });
  });

  it("does not treat a system notice as something they said", () => {
    render(
      <MessageBubble
        msg={makeMessage({ origin: "system-notice", content: "TA 这会儿没回" })}
        personaName="小A"
        showMood={false}
        personaId={3}
        onRegenerate={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText(translate("zh", "chat.unlike"))).toBeNull();
    expect(screen.queryByLabelText(translate("zh", "chat.regenerate"))).toBeNull();
  });

  it("renders a recalled line as a small notice, not as something they said", () => {
    render(
      <MessageBubble
        msg={makeMessage({ origin: "recall", content: "[recall]" })}
        personaName="小A"
        showMood={false}
        personaId={3}
        onRegenerate={vi.fn()}
      />,
    );
    expect(screen.getByText("小A 撤回了一条消息")).toBeInTheDocument();
    expect(screen.queryByText("[recall]")).toBeNull();
    expect(screen.queryByLabelText(translate("zh", "chat.unlike"))).toBeNull();
    expect(screen.queryByLabelText(translate("zh", "chat.regenerate"))).toBeNull();
  });

  it("marks a follow-up as one they used to send", () => {
    render(
      <MessageBubble
        msg={makeMessage({ origin: "followup", content: "人呢" })}
        personaName="小A"
        showMood={false}
        personaId={3}
      />,
    );
    expect(screen.getByText("人呢")).toBeInTheDocument();
    expect(screen.getByText("照 小A 以前的习惯追的一句")).toBeInTheDocument();
    expect(screen.queryByText("TA 先开口了")).toBeNull();
  });

  it("renders a tap as a small notice, not as something they said", () => {
    render(
      <MessageBubble
        msg={makeMessage({ origin: "pat", content: "[pat]" })}
        personaName="小A"
        showMood={false}
        personaId={3}
        onRegenerate={vi.fn()}
      />,
    );
    expect(screen.getByText("小A 拍了拍你")).toBeInTheDocument();
    expect(screen.queryByText("[pat]")).toBeNull();
    expect(screen.queryByLabelText(translate("zh", "chat.unlike"))).toBeNull();
    expect(screen.queryByLabelText(translate("zh", "chat.regenerate"))).toBeNull();
  });
});
