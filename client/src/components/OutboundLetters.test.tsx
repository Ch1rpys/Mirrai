// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

/**
 * The way out.
 *
 * The contract this component has to keep is narrow and absolute: the
 * app collects the user's own words and hands them back, and it never
 * sends anything. There is no "send" button here — there is an "I said
 * it" button, which is a different thing — and there is somewhere for a
 * letter to go when the other person is not there any more.
 */
const collect = vi.fn();
const markSent = vi.fn();
const drop = vi.fn();
const keepForSelf = vi.fn();
const updateText = vi.fn();
const markStaleNotified = vi.fn();
const restore = vi.fn();
const addOwn = vi.fn();
const saveOutcome = vi.fn();
const dismissSaidItHint = vi.fn();
const navigate = vi.fn();

let letters: any[] = [];
let saidItHint = false;

vi.mock("wouter", () => ({
  useLocation: () => ["/chat/5", navigate],
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    outbound: {
      list: { useQuery: () => ({ data: { letters, saidItHint }, refetch: vi.fn() }) },
      collect: { useMutation: () => ({ mutate: collect, isPending: false }) },
      markSent: { useMutation: () => ({ mutate: markSent, isPending: false }) },
      drop: { useMutation: () => ({ mutate: drop, isPending: false }) },
      keepForSelf: { useMutation: () => ({ mutate: keepForSelf, isPending: false }) },
      restore: { useMutation: () => ({ mutate: restore, isPending: false }) },
      markStaleNotified: {
        useMutation: () => ({
          mutate: (input: any, options: any) => {
            markStaleNotified(input, options);
          },
          isPending: false,
        }),
      },
      updateText: {
        useMutation: () => ({
          mutate: (input: any, options: any) => {
            updateText(input, options);
          },
          isPending: false,
        }),
      },
      addOwn: {
        useMutation: (options?: any) => ({
          mutate: (input: any) => {
            addOwn(input);
            options?.onSuccess?.();
          },
          isPending: false,
        }),
      },
      saveOutcome: {
        useMutation: (options?: any) => ({
          mutate: (input: any) => {
            saveOutcome(input);
            options?.onSuccess?.({ saved: true });
          },
          isPending: false,
        }),
      },
      dismissSaidItHint: {
        useMutation: (options?: any) => ({
          mutate: (input: any) => {
            dismissSaidItHint(input);
            options?.onSuccess?.({ success: true });
          },
          isPending: false,
        }),
      },
    },
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

import OutboundLetters from "./OutboundLetters";
import { ConfirmProvider } from "@/components/ConfirmDialog";

describe("the way out", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    letters = [];
    saidItHint = false;
  });

  it("says so when there is nothing to take back", () => {
    render(<ConfirmProvider><OutboundLetters personaId={1} /></ConfirmProvider>);
    expect(screen.getByText(translate("zh", "outbound.empty"))).toBeInTheDocument();
  });

  it("lets the user change their mind about a letter they said no to", async () => {
    /**
     * The confirmation promised the words would be thrown away with no
     * way to get them back — but the server only marked the letter,
     * and the text stayed right there in the list with no button to
     * press. So the promise was false, and the user had no way back.
     */
    const user = userEvent.setup();
    letters = [{ id: 3, status: "dropped", text: "一句话", createdAt: new Date().toISOString() }];
    render(<ConfirmProvider><OutboundLetters personaId={1} /></ConfirmProvider>);

    await user.click(screen.getByRole("button", { name: translate("zh", "outbound.restore") }));

    expect(restore).toHaveBeenCalledWith({ id: 3 });
  });

  it("shows the user's own words", () => {
    letters = [
      {
        id: 1,
        status: "ready",
        text: "我其实很害怕你离开我",
        sourceMessageId: 12,
        createdAt: new Date().toISOString(),
      },
    ];
    render(<ConfirmProvider><OutboundLetters personaId={1} /></ConfirmProvider>);
    expect(screen.getByText("我其实很害怕你离开我")).toBeInTheDocument();
  });

  it("never offers to send anything", () => {
    // The absence of a send button is the whole contract. The app
    // collects and hands back; the person in the conversation is the one
    // who says it.
    letters = [
      { id: 1, status: "ready", text: "一句话", createdAt: new Date().toISOString() },
    ];
    render(<ConfirmProvider><OutboundLetters personaId={1} /></ConfirmProvider>);
    expect(screen.queryByText(translate("zh", "outbound.markSent"))).toBeTruthy();
    expect(screen.queryByText(/发送|send/i)).toBeNull();
  });

  it("looks through the conversation for what was only said here", async () => {
    render(<ConfirmProvider><OutboundLetters personaId={1} /></ConfirmProvider>);
    await userEvent.click(screen.getByText(translate("zh", "outbound.collect")));
    await waitFor(() => expect(collect).toHaveBeenCalled());
    expect(collect.mock.calls[0][0]).toMatchObject({ personaId: 1 });
  });

  it("records that the user said it", async () => {
    letters = [
      { id: 1, status: "ready", text: "一句话", createdAt: new Date().toISOString() },
    ];
    render(<ConfirmProvider><OutboundLetters personaId={1} /></ConfirmProvider>);
    await userEvent.click(screen.getByText(translate("zh", "outbound.markSent")));
    await waitFor(() => expect(markSent).toHaveBeenCalled());
    expect(markSent.mock.calls[0][0]).toMatchObject({ id: 1 });
  });

  it("gives a letter somewhere to go when the other person is not there", async () => {
    letters = [
      { id: 1, status: "ready", text: "一句话", createdAt: new Date().toISOString() },
    ];
    render(<ConfirmProvider><OutboundLetters personaId={1} /></ConfirmProvider>);
    await userEvent.click(screen.getByText(translate("zh", "outbound.forSelf")));
    await waitFor(() => expect(keepForSelf).toHaveBeenCalled());
  });

  it("mentions a letter that has been waiting too long", () => {
    const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
    letters = [{ id: 1, status: "ready", text: "一句话", createdAt: old }];
    render(<ConfirmProvider><OutboundLetters personaId={1} /></ConfirmProvider>);
    expect(screen.getByText(/不会自己消失/)).toBeInTheDocument();
  });

  it("says it once — and records that it said it", async () => {
    const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
    letters = [{ id: 1, status: "ready", text: "一句话", createdAt: old }];
    render(<ConfirmProvider><OutboundLetters personaId={1} /></ConfirmProvider>);

    await waitFor(() => expect(markStaleNotified).toHaveBeenCalled());
    expect(markStaleNotified.mock.calls[0][0]).toMatchObject({ id: 1 });
  });

  it("says it again when the record could not be written", async () => {
    /**
     * The server used to say "success" whatever happened — so a write
     * that found nothing looked exactly like a write that worked. The
     * panel then kept quiet about the letter for the rest of the
     * session and never tried again, and the next time it was opened
     * it said the same reminder again — over and over, with no way to
     * stop it.
     */
    const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
    const letter = { id: 1, status: "ready", text: "一句话", createdAt: old };
    letters = [letter];
    const { rerender } = render(
      <ConfirmProvider><OutboundLetters personaId={1} /></ConfirmProvider>,
    );

    await waitFor(() => expect(markStaleNotified).toHaveBeenCalledTimes(1));
    const options = markStaleNotified.mock.calls[0][1];
    expect(options).toBeTruthy();

    // The panel is told it was not recorded, so the mark is taken off.
    act(() => {
      options.onSuccess({ recorded: false });
    });

    // So the next time the list is read, it is said again.
    letters = [{ ...letter }];
    rerender(<ConfirmProvider><OutboundLetters personaId={1} /></ConfirmProvider>);
    await waitFor(() => expect(markStaleNotified).toHaveBeenCalledTimes(2));
  });

  it("does not say it again when the record was written", async () => {
    const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
    const letter = { id: 1, status: "ready", text: "一句话", createdAt: old };
    letters = [letter];
    const { rerender } = render(
      <ConfirmProvider><OutboundLetters personaId={1} /></ConfirmProvider>,
    );

    await waitFor(() => expect(markStaleNotified).toHaveBeenCalledTimes(1));
    act(() => {
      markStaleNotified.mock.calls[0][1].onSuccess({ recorded: true });
    });

    letters = [{ ...letter }];
    rerender(<ConfirmProvider><OutboundLetters personaId={1} /></ConfirmProvider>);
    await waitFor(() => expect(markStaleNotified).toHaveBeenCalledTimes(1));
  });

  it("does not say it again once it has been said", () => {
    const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
    letters = [
      {
        id: 1,
        status: "ready",
        text: "一句话",
        createdAt: old,
        staleNotifiedAt: new Date().toISOString(),
      },
    ];
    render(<ConfirmProvider><OutboundLetters personaId={1} /></ConfirmProvider>);
    // It was said before, in another session. Saying it again would be
    // nagging, and nagging is the one thing this product promises not
    // to do.
    expect(screen.queryByText(/不会自己消失/)).toBeNull();
  });

  it("keeps the other editor open when a save comes back", async () => {
    /**
     * The save of the first letter comes back while the user is
     * rewriting the second one.
     */
    let finishSave: (() => void) | null = null;
    updateText.mockImplementationOnce((_input: any, options: any) => {
      finishSave = () => options.onSuccess?.();
    });

    letters = [
      { id: 1, status: "ready", text: "第一封", createdAt: new Date().toISOString() },
      { id: 2, status: "ready", text: "第二封", createdAt: new Date().toISOString() },
    ];
    render(<ConfirmProvider><OutboundLetters personaId={1} /></ConfirmProvider>);

    // Open the first one and rewrite it.
    const editButtons = screen.getAllByLabelText(translate("zh", "outbound.edit"));
    await userEvent.click(editButtons[0]);
    const editors = screen.getAllByLabelText(translate("zh", "outbound.editLabel"));
    await userEvent.clear(editors[0]);
    await userEvent.type(editors[0], "改过的第一封");
    await userEvent.click(screen.getAllByText(translate("zh", "microRules.save"))[0]);

    // Now open the second one and start rewriting it.
    await userEvent.click(screen.getAllByLabelText(translate("zh", "outbound.edit"))[1]);
    const editors2 = screen.getAllByLabelText(translate("zh", "outbound.editLabel"));
    await userEvent.clear(editors2[0]);
    await userEvent.type(editors2[0], "改过的第二封");

    // The first save comes back.
    //
    // The act() is what makes the state change take effect here: without
    // it the assertion would run before React had painted the change,
    // and would pass against the old code as well.
    act(() => {
      finishSave?.();
    });

    // The second editor is still open, with what was typed in it.
    await waitFor(() => {
      const still = screen.getAllByLabelText(translate("zh", "outbound.editLabel"));
      expect(still).toHaveLength(1);
      expect(still[0]).toHaveValue("改过的第二封");
    });
  });

  it("does not mention a letter that was just written", () => {
    letters = [
      { id: 1, status: "ready", text: "一句话", createdAt: new Date().toISOString() },
    ];
    render(<ConfirmProvider><OutboundLetters personaId={1} /></ConfirmProvider>);
    expect(screen.queryByText(/不会自己消失/)).toBeNull();
  });

  it("lets the user write one themselves", async () => {
    const user = userEvent.setup();
    render(<ConfirmProvider><OutboundLetters personaId={5} name="小满" /></ConfirmProvider>);
    const box = screen.getByLabelText(translate("zh", "outbound.writeOwn"));
    await user.type(box, "  那天我应该留下来的  ");
    await user.click(screen.getByRole("button", { name: translate("zh", "outbound.addOwn") }));
    expect(addOwn).toHaveBeenCalledWith({ personaId: 5, text: "那天我应该留下来的" });
    // The box is empty again, so the next sentence starts clean.
    await waitFor(() => expect(box).toHaveValue(""));
  });
});

describe("after the words have been said (C3.5)", () => {
  it("turns the letter into a quiet card with an optional note", () => {
    letters = [
      {
        id: 7,
        status: "sent",
        text: "我说了",
        createdAt: new Date("2026-03-01T10:00:00Z").toISOString(),
        sentAt: new Date("2026-03-02T10:00:00Z").toISOString(),
      },
    ];
    render(<ConfirmProvider><OutboundLetters personaId={5} name="小满" /></ConfirmProvider>);
    expect(screen.getByText(/你把这句话对 小满 说了。/)).toBeInTheDocument();
    expect(screen.getByLabelText(translate("zh", "outbound.outcomePlaceholder"))).toBeInTheDocument();
  });

  it("keeps what the user writes, exactly", async () => {
    const user = userEvent.setup();
    letters = [{ id: 7, status: "sent", text: "我说了", createdAt: new Date().toISOString() }];
    render(<ConfirmProvider><OutboundLetters personaId={5} name="小满" /></ConfirmProvider>);
    await user.type(
      screen.getByLabelText(translate("zh", "outbound.outcomePlaceholder")),
      "她沉默了一会儿，说「我知道了」。",
    );
    await user.click(screen.getByRole("button", { name: translate("zh", "outbound.saveOutcome") }));
    expect(saveOutcome).toHaveBeenCalledWith({
      id: 7,
      note: "她沉默了一会儿，说「我知道了」。",
    });
  });

  it("offers the last page only while the hint has not been made", () => {
    letters = [
      { id: 7, status: "sent", text: "我说了", createdAt: new Date().toISOString() },
      { id: 8, status: "sent", text: "还有一句", createdAt: new Date().toISOString() },
    ];
    saidItHint = true;
    const { unmount } = render(
      <ConfirmProvider><OutboundLetters personaId={5} name="小满" /></ConfirmProvider>,
    );
    expect(screen.getAllByText(/画个句号/)).toHaveLength(1);
    unmount();

    saidItHint = false;
    render(<ConfirmProvider><OutboundLetters personaId={5} name="小满" /></ConfirmProvider>);
    expect(screen.queryByText(/画个句号/)).toBeNull();
  });

  it("goes to the farewell page when the hint is followed", async () => {
    const user = userEvent.setup();
    letters = [{ id: 7, status: "sent", text: "我说了", createdAt: new Date().toISOString() }];
    saidItHint = true;
    render(<ConfirmProvider><OutboundLetters personaId={5} name="小满" /></ConfirmProvider>);
    await user.click(screen.getByText(/画个句号/));
    expect(dismissSaidItHint).toHaveBeenCalledWith({ personaId: 5 });
    expect(navigate).toHaveBeenCalledWith("/persona/5/graduation");
  });

  it("keeps a note that was already written without asking again", () => {
    letters = [
      {
        id: 7,
        status: "sent",
        text: "我说了",
        createdAt: new Date().toISOString(),
        outcomeNote: "她说了「我知道了」。",
      },
    ];
    render(<ConfirmProvider><OutboundLetters personaId={5} name="小满" /></ConfirmProvider>);
    expect(screen.getByText("她说了「我知道了」。")).toBeInTheDocument();
    expect(screen.queryByLabelText(translate("zh", "outbound.outcomePlaceholder"))).toBeNull();
  });
});
