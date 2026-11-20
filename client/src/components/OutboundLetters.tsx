import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Send, Search, Check, X, Pencil, BookMarked, Undo2, Sparkles } from "lucide-react";
import { daysWaiting, isStale } from "@shared/outbound";
import { useConfirm } from "@/components/ConfirmDialog";
import { formatInstantInZone } from "@/lib/dates";
import CrisisCard from "@/components/CrisisCard";
import type { WordingSuggestion } from "@shared/wording";

/**
 * The way out.
 *
 * The graduation ends with a letter in the persona's voice. But what was
 * actually unfinished was never the persona's sentence — it was the
 * user's. They said things here that they never managed to say to the
 * person they were talking about, and saying them here was the useful
 * part.
 *
 * So the goodbye has an exit as well as a door: the words that were only
 * ever said to the persona, collected and handed back.
 *
 * Nothing is sent. The app never speaks for the person who is not in the
 * room — it can only put the words in front of the user and let them
 * decide. That is the whole contract, and it is why this component has
 * no "send" button: there is a "I said it" button, and that is a
 * different thing entirely.
 */
export default function OutboundLetters({ personaId, name }: { personaId: number; name?: string }) {
  const { t, locale } = useLocale();
  /**
   * The app's own confirmation.
   *
   * It was the browser's own dialog — whose buttons say "OK" and
   * "Cancel" in the *browser's* language, not the language the person
   * is reading the app in.
   */
  const confirm = useConfirm();
  const [, navigate] = useLocation();
  const { data, refetch, isLoading, isError } = trpc.outbound.list.useQuery({ personaId });
  const collectMutation = trpc.outbound.collect.useMutation({
    onSuccess: (result) => {
      if (result.saved) {
        toast.success(t("outbound.collected", { count: result.saved }));
      } else {
        toast.info(t("outbound.collectedNone"));
      }
      refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const sentMutation = trpc.outbound.markSent.useMutation({
    onSuccess: () => refetch(),
    onError: (e: any) => toast.error(e.message),
  });
  const dropMutation = trpc.outbound.drop.useMutation({
    onSuccess: () => refetch(),
    onError: (e: any) => toast.error(e.message),
  });
  const selfMutation = trpc.outbound.keepForSelf.useMutation({
    onSuccess: () => refetch(),
    onError: (e: any) => toast.error(e.message),
  });
  /**
   * "Actually, I do want to say it."
   *
   * The words were never thrown away — the letter stays in the list
   * with its text — so the decision has to be reversible. Otherwise
   * the user is shown their own words with no way to act on them
   * again.
   */
  const restoreMutation = trpc.outbound.restore.useMutation({
    onSuccess: () => refetch(),
    onError: (e: any) => toast.error(e.message),
  });
  /**
   * The reminder is said once.
   *
   * Nobody asked for it — the panel says it on its own — so a failure
   * is not the user's news and there is nothing they could do about
   * it. It used to raise an error toast every time, which is a red
   * box for something the user never did and cannot change.
   */
  const staleMutation = trpc.outbound.markStaleNotified.useMutation();
  const updateMutation = trpc.outbound.updateText.useMutation({
    onSuccess: () => refetch(),
    onError: (e: any) => toast.error(e.message),
  });
  /**
   * A sentence with no message behind it (C3.3).
   *
   * The list is not only for lines found in the conversation: sometimes
   * the sentence was never typed anywhere, and the drawer is where a
   * person is reminded of the one they have been carrying around.
   */
  const addOwnMutation = trpc.outbound.addOwn.useMutation({
    onSuccess: () => {
      setOwn("");
      toast.success(t("outbound.keep"));
      refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const [own, setOwn] = useState("");
  /**
   * How it went after the user said it (C3.5).
   *
   * The note is optional, it is written in the user's own words, and it
   * is not asked for again. There is deliberately no success message: the
   * card simply keeps the sentence.
   */
  const saveOutcome = trpc.outbound.saveOutcome.useMutation({
    onSuccess: () => refetch(),
    onError: (e: any) => toast.error(e.message),
  });
  const dismissSaidItHint = trpc.outbound.dismissSaidItHint.useMutation({
    onSuccess: () => refetch(),
  });
  const [outcomes, setOutcomes] = useState<Record<number, string>>({});
  /**
   * The wording assistant (C3.6).
   *
   * A suggestion is only ever offered. It goes into the editor when the
   * user adopts it, and only becomes the letter when they save.
   */
  const [suggestions, setSuggestions] = useState<Record<number, WordingSuggestion[]>>({});
  const [crisisFor, setCrisisFor] = useState<number | null>(null);
  const [assistedId, setAssistedId] = useState<number | null>(null);
  const suggestMutation = trpc.outbound.suggestWording.useMutation({
    onSuccess: (result: { suggestions: WordingSuggestion[]; crisis: boolean }, variables: { id: number }) => {
      if (result.crisis) {
        setCrisisFor(variables.id);
        return;
      }
      setSuggestions((current) => ({ ...current, [variables.id]: result.suggestions }));
    },
    onError: (e: any) => toast.error(e.message),
  });

  const letters = data?.letters ?? [];
  /** The card the one-time hint hangs from: the first letter that was said. */
  const firstSentId = letters.find((letter: any) => letter.status === "sent")?.id;
  const [editing, setEditing] = useState<number | null>(null);
  const [text, setText] = useState("");
  /**
   * The one-time invitation to the last page (C3.5).
   *
   * It has to be marked as shown when it is shown, not only when it is
   * clicked — otherwise a person who reads it and does nothing sees it
   * again on every visit. The local flag keeps it on screen for this
   * visit while the server records that it was offered.
   */
  const [saidItHintVisible, setSaidItHintVisible] = useState(false);
  const saidItHintMarked = useRef(false);
  useEffect(() => {
    if (!data?.saidItHint || firstSentId == null || saidItHintMarked.current) return;
    saidItHintMarked.current = true;
    setSaidItHintVisible(true);
    dismissSaidItHint.mutate({ personaId });
  }, [data?.saidItHint, firstSentId, dismissSaidItHint, personaId]);

  /**
   * The letters that have been pointed out in this session.
   *
   * The reminder is said once — and "once" has to survive both a
   * refetch and a reload. The server records it, so a later session
   * stays quiet; this set keeps the line on screen for the rest of this
   * one, so that recording it does not make it blink away.
   */
  const mentioned = useRef(new Set<number>());

  useEffect(() => {
    for (const letter of letters) {
      if (!isStale(letter)) continue;
      if (letter.staleNotifiedAt || mentioned.current.has(letter.id)) continue;
      mentioned.current.add(letter.id);
      staleMutation.mutate(
        { id: letter.id },
        {
          onSuccess: (result: { recorded: boolean }) => {
            /**
             * The record did not happen.
             *
             * The letter is marked as said, so the line stays on
             * screen and the panel is quiet — but nothing was
             * written, so the next time the panel is opened it would
             * say it again, and the user would see the same reminder
             * over and over with no way to stop it. So the mark is
             * taken off, and it is said again next time.
             */
            if (result && result.recorded === false) {
              mentioned.current.delete(letter.id);
            }
          },
        },
      );
    }
  }, [letters]);

  function beginEdit(id: number, current: string) {
    setEditing(id);
    setText(current);
    // Opening the editor by hand is not adopting a suggestion.
    setAssistedId(null);
  }

  /** "Use this one": it fills the editor; the user still has to save. */
  function adoptSuggestion(id: number, current: string) {
    setEditing(id);
    setText(current);
    setAssistedId(id);
  }

  function saveEdit(id: number) {
    const trimmed = text.trim();
    if (!trimmed) {
      // A letter with nothing in it is not a letter.
      toast.error(t("outbound.editRequired"));
      return;
    }
    // The editor stays open until the server has taken the text.
    //
    // It used to close at once, so a failed save threw the user's
    // rewritten words away with no way of getting them back — the only
    // trace was the error toast.
    updateMutation.mutate(
      { id, text: trimmed, assisted: assistedId === id },
      {
        onSuccess: () => {
          setAssistedId(null);
          /**
           * Only the editor that was saved is closed.
           *
           * It used to close *whichever* editor was open — so the user
           * who saved one letter and then started rewriting another had
           * their new words thrown away the moment the first save came
           * back, with no warning and no undo.
           */
          setEditing((current) => (current === id ? null : current));
        },
      },
    );
  }

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <div className="flex items-center justify-between gap-3">
          <h2 className="section-title">{t("outbound.title")}</h2>
          <Button
            size="sm"
            variant="outline"
            className="rounded-md px-4"
            onClick={() => collectMutation.mutate({
              personaId,
              // The letters are written in the language the reader
              // reads: the procedure defaulted to Chinese.
              locale: locale === "en" ? "en" : "zh",
            })}
            disabled={collectMutation.isPending}
          >
            <Search className="w-3.5 h-3.5" />
            {collectMutation.isPending ? t("outbound.collecting") : t("outbound.collect")}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">{t("outbound.hint")}</p>
      </header>

      <form
        className="space-y-2 rounded-xl border border-border/70 p-3"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = own.trim();
          if (!trimmed || addOwnMutation.isPending) return;
          addOwnMutation.mutate({ personaId, text: trimmed });
        }}
      >
        <Label className="text-xs text-muted-foreground" htmlFor="outbound-own">
          {t("outbound.writeOwn")}
        </Label>
        <Textarea
          id="outbound-own"
          value={own}
          rows={2}
          maxLength={2000}
          placeholder={t("outbound.writeOwnPlaceholder", { name: name || t("common.them") })}
          onChange={(event) => setOwn(event.target.value)}
        />
        <div className="flex justify-end">
          <Button type="submit" size="sm" variant="outline" disabled={!own.trim() || addOwnMutation.isPending}>
            {t("outbound.addOwn")}
          </Button>
        </div>
      </form>

      {letters.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border/70 px-4 py-8 text-center text-xs text-muted-foreground">
          {/* A failed request leaves the list empty, so the panel said
              "nothing here" — a claim about the user's own letters that
              was simply false. */}
          {isLoading ? t("common.loading") : isError ? t("common.error") : t("outbound.empty")}
        </p>
      ) : null}

      <ul className="space-y-3">
        {letters.map((letter: any) => (
          <li key={letter.id} className="rounded-xl border border-border/70 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[11px]">
                {/**
                    The badge says what the letter is.

                    It used to know three states and fall through to the
                    draft label for everything else — so a letter the
                    user had kept for themselves (the server's status
                    "self") was badged 「还在写」 / "Still writing",
                    which is the opposite of what they had just done.
                    There was no wording for that state at all.
                    */}
                {letter.status === "sent"
                  ? t("outbound.statusSent")
                  : letter.status === "dropped"
                    ? t("outbound.statusDropped")
                    : letter.status === "self"
                      ? t("outbound.statusSelf")
                      : letter.status === "ready"
                        ? t("outbound.statusReady")
                        : t("outbound.statusDraft")}
              </Badge>
              {letter.sourceMessageId ? (
                <span className="text-[11px] text-muted-subtle">
                  {t("outbound.source")}
                </span>
              ) : null}
              {letter.wordingAssisted ? (
                <span className="text-[11px] text-muted-subtle">{t("outbound.assistedMark")}</span>
              ) : null}
              <div className="ml-auto flex items-center gap-1">
                {/**
                    The buttons are for a letter the user still has
                    something to do with. A letter they kept for
                    themselves is not one of those: they have already
                    decided, and the buttons still offered to edit it,
                    to say they had said it, and to drop it.
                    */}
                {letter.status !== "sent" && letter.status !== "dropped" && letter.status !== "self" ? (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t("outbound.edit")}
                      onClick={() => beginEdit(letter.id, letter.text)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    {/**
                     * The buttons wait.
                     *
                     * Every one of them fired the mutation on each
                     * click, so a double click sent two — and the
                     * second one failed, because the letter had
                     * already been dealt with. The user saw a success
                     * message and then an error, for one press.
                     */}
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={sentMutation.isPending}
                      onClick={() => sentMutation.mutate({ id: letter.id })}
                    >
                      <Check className="h-3.5 w-3.5" />
                      {t("outbound.markSent")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={selfMutation.isPending}
                      onClick={() => selfMutation.mutate({ id: letter.id })}
                    >
                      <BookMarked className="h-3.5 w-3.5" />
                      {t("outbound.forSelf")}
                    </Button>
                    {/**
                     * Dropping is for ever.
                     *
                     * The other panels ask before they remove
                     * something — the letters, the relationship events.
                     * This one did not, and there is no way to undo it:
                     * one click discarded a letter the user wrote, and
                     * the app's own framing is that these words were
                     * only ever said to the persona.
                     */}
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={dropMutation.isPending}
                      onClick={async () => {
                        const yes = await confirm({ description: t("outbound.dropConfirm") });
                        if (!yes) return;
                        dropMutation.mutate({ id: letter.id });
                      }}
                    >
                      <X className="h-3.5 w-3.5" />
                      {t("outbound.drop")}
                    </Button>
                  </>
                ) : null}
                {/**
                 * A letter the user said no to can be said to after all.
                 *
                 * The confirmation promised the words would be thrown
                 * away with no way to get them back — but the server
                 * only marked the letter, and the text stayed right
                 * there in the list with no button to press. So the
                 * promise was false, and the user had no way back.
                 */}
                {letter.status === "dropped" ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={restoreMutation.isPending}
                    onClick={() => restoreMutation.mutate({ id: letter.id })}
                  >
                    <Undo2 className="h-3.5 w-3.5" />
                    {t("outbound.restore")}
                  </Button>
                ) : null}
              </div>
            </div>

            {isStale(letter) && (!letter.staleNotifiedAt || mentioned.current.has(letter.id)) ? (
              <p className="text-[11px] text-muted-subtle">
                {t("outbound.staleHint", { days: daysWaiting(letter) })}
              </p>
            ) : null}

            {letter.status === "sent" ? (
              <div className="space-y-2" data-outbound-outcome>
                <p className="text-sm text-foreground/90 leading-relaxed">
                  {t("outbound.saidCard", {
                    date: formatInstantInZone(letter.sentAt ?? letter.createdAt, locale),
                    name: name || t("common.them"),
                  })}
                </p>
                {letter.outcomeNote ? (
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground leading-relaxed">
                    {letter.outcomeNote}
                  </p>
                ) : (
                  <>
                    <Textarea
                      aria-label={t("outbound.outcomePlaceholder")}
                      placeholder={t("outbound.outcomePlaceholder")}
                      value={outcomes[letter.id] ?? ""}
                      rows={2}
                      maxLength={2000}
                      onChange={(event) =>
                        setOutcomes((current) => ({ ...current, [letter.id]: event.target.value }))
                      }
                    />
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={saveOutcome.isPending || !(outcomes[letter.id] ?? "").trim()}
                        onClick={() =>
                          saveOutcome.mutate({ id: letter.id, note: outcomes[letter.id] ?? "" })
                        }
                      >
                        {t("outbound.saveOutcome")}
                      </Button>
                    </div>
                  </>
                )}
                {saidItHintVisible && firstSentId === letter.id ? (
                  <button
                    type="button"
                    onClick={() => {
                      dismissSaidItHint.mutate({ personaId });
                      navigate(`/persona/${personaId}/graduation`);
                    }}
                    className="text-left text-[11px] text-muted-subtle hover:text-muted-foreground underline underline-offset-2"
                  >
                    {t("outbound.saidItHint")}
                  </button>
                ) : null}
              </div>
            ) : editing === letter.id ? (
              <div className="space-y-2">
                <Label className="sr-only" htmlFor={`outbound-letter-${letter.id}`}>{t("outbound.editLabel")}</Label>
                <Textarea id={`outbound-letter-${letter.id}`} value={text} onChange={(e) => setText(e.target.value)} rows={3} />
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
                    {t("microRules.cancel")}
                  </Button>
                  <Button size="sm" disabled={updateMutation.isPending} onClick={() => saveEdit(letter.id)}>
                    <Send className="h-3.5 w-3.5" />
                    {t("microRules.save")}
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">
                {letter.text}
              </p>
            )}

            {letter.status !== "sent" && letter.status !== "dropped" && letter.status !== "self" ? (
              <div className="space-y-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={suggestMutation.isPending}
                  onClick={() => suggestMutation.mutate({ id: letter.id })}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {t("outbound.suggest")}
                </Button>

                {crisisFor === letter.id ? (
                  <CrisisCard onClose={() => setCrisisFor(null)} />
                ) : null}

                {(suggestions[letter.id] ?? []).length > 0 ? (
                  <div className="space-y-2 rounded-md border border-border/70 bg-muted/20 p-3">
                    <p className="text-[11px] text-muted-subtle">{t("outbound.suggestionsTitle")}</p>
                    <ul className="space-y-2">
                      {(suggestions[letter.id] ?? []).map((suggestion) => (
                        <li key={suggestion.kind} className="flex items-start gap-3">
                          <span className="mt-0.5 shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {suggestion.kind === "direct"
                              ? t("outbound.suggestionDirect")
                              : suggestion.kind === "soft"
                                ? t("outbound.suggestionSoft")
                                : t("outbound.suggestionShort")}
                          </span>
                          <p className="min-w-0 flex-1 text-sm text-foreground/85 leading-relaxed">
                            {suggestion.text}
                          </p>
                          <button
                            type="button"
                            onClick={() => adoptSuggestion(letter.id, suggestion.text)}
                            className="shrink-0 text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
                          >
                            {t("outbound.adopt")}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
