import { useMemo, useRef, useState, type FormEvent } from "react";
import { useLocation, useParams } from "wouter";
import { ArrowLeft, Send, Trash2, Users } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { useConfirm } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PersonaAvatar } from "@/components/PersonaAvatar";
import { toast } from "sonner";

/** A member of the room, as `group.history` sends the room. */
interface GroupMember {
  personaId: number;
  name: string;
  avatarUrl: string | null;
  hasGroupData: boolean;
  available: boolean;
}

/** One line in the room, as `group.history` sends it. */
interface GroupMessage {
  id: number;
  role: "user" | "assistant";
  personaId: number | null;
  personaName: string | null;
  content: string;
  createdAt: string;
}

/**
 * The group chat page (C9.8).
 *
 * A room is a group of the user's own personas. The fixed note at the
 * top says the one thing that must never be misunderstood: everyone in
 * the room but the user is a persona, and they only speak after the
 * user does. There is no "they are talking to each other" mode.
 *
 * The page says the three states of its one read: still loading, failed
 * with a retry, and empty — a failure must never look like an empty
 * conversation. A refetch that fails after data has arrived keeps the
 * messages on screen and says the history is stale instead of blanking
 * the room.
 */
export default function Group() {
  const params = useParams<{ id: string }>();
  const roomId = Number(params.id);
  const validId = Number.isFinite(roomId) && roomId > 0;
  const { t } = useLocale();
  const [, navigate] = useLocation();
  const confirm = useConfirm();

  const history = trpc.group.history.useQuery({ roomId }, { enabled: validId });
  const send = trpc.group.send.useMutation();
  const deleteRoom = trpc.group.delete.useMutation();

  const [text, setText] = useState("");
  const [sendFailed, setSendFailed] = useState(false);
  const [crisisText, setCrisisText] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const room = history.data?.room;
  const members: GroupMember[] = room?.members ?? [];
  const messages: GroupMessage[] = history.data?.messages ?? [];

  /**
   * The mention token being typed, or null.
   *
   * `@` at the start of the input or after a space opens the member
   * list; the characters after it filter the list. Choosing a name puts
   * `@名字 ` in the input.
   */
  const mentionToken = text.match(/(?:^|\s)@([^\s@]*)$/)?.[1] ?? null;
  const mentionMatches = useMemo(() => {
    if (mentionToken === null) return [];
    const query = mentionToken.trim();
    return members.filter((member) => !query || member.name.includes(query));
  }, [mentionToken, members]);
  const mentionOpen = mentionToken !== null && mentionMatches.length > 0;

  const errorCode = (history.error as { data?: { code?: string } } | null)?.data?.code;
  const notFound = history.isError && (errorCode === "NOT_FOUND" || errorCode === "FORBIDDEN");

  function pickMention(name: string) {
    setText((current) => {
      const at = current.lastIndexOf("@");
      if (at < 0) return current;
      return `${current.slice(0, at)}@${name} `;
    });
    inputRef.current?.focus();
  }

  function submit() {
    const trimmed = text.trim();
    if (!trimmed || send.isPending || !validId) return;
    setText("");
    setSendFailed(false);
    setCrisisText(null);
    send.mutate(
      { roomId, text: trimmed },
      {
        onSuccess: (data) => {
          if (data?.crisis) setCrisisText(data.crisis.text);
          void history.refetch();
        },
        onError: () => setSendFailed(true),
      },
    );
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    submit();
  }

  async function askDeleteRoom() {
    const yes = await confirm({
      title: t("group.deleteRoom"),
      description: t("group.deleteRoomConfirm"),
      confirmLabel: t("group.deleteRoom"),
      cancelLabel: t("group.cancel"),
      destructive: true,
    });
    if (!yes) return;
    deleteRoom.mutate(
      { roomId },
      {
        onSuccess: () => {
          toast.success(t("group.deleted"));
          navigate("/");
        },
        onError: (error: { message: string }) => toast.error(error.message),
      },
    );
  }

  const avatarFor = (message: GroupMessage): string | null => {
    if (message.role === "user" || message.personaId == null) return null;
    return members.find((member) => member.personaId === message.personaId)?.avatarUrl ?? null;
  };
  const nameFor = (message: GroupMessage): string =>
    message.role === "user" ? t("group.you") : message.personaName ?? "";

  return (
    <div className="min-h-screen bg-background">
      {/* The one thing that must not be misunderstood (C9.8). */}
      <div
        role="note"
        className="sticky top-0 z-30 border-b border-border bg-background px-4 py-2.5 text-center text-xs leading-relaxed text-muted-foreground"
      >
        {t("group.banner")}
      </div>

      <div className="container max-w-5xl py-5 space-y-4">
        <header className="flex items-start gap-2">
          <button
            type="button"
            onClick={() => navigate("/")}
            aria-label={t("common.back")}
            className="app-nav-icon mt-0.5"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="kicker">{t("group.title")}</p>
            <h1 className="page-title truncate">{room?.name ?? t("group.title")}</h1>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-md bg-transparent flex-shrink-0"
            disabled={!room || deleteRoom.isPending}
            onClick={() => void askDeleteRoom()}
          >
            <Trash2 className="w-3.5 h-3.5" />
            {t("group.deleteRoom")}
          </Button>
        </header>

        {!validId || notFound ? (
          <div className="surface p-10 text-center space-y-3">
            <p className="text-sm text-foreground/85">{t("group.notFound")}</p>
            <button
              type="button"
              className="text-xs underline underline-offset-2 text-muted-foreground hover:text-foreground"
              onClick={() => navigate("/")}
            >
              {t("common.back")}
            </button>
          </div>
        ) : !history.data && history.isError ? (
          <div className="surface p-8 text-center space-y-3" role="alert">
            <p className="text-sm text-foreground/85">{t("group.loadFailed")}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-md bg-transparent"
              onClick={() => void history.refetch()}
            >
              {t("group.retry")}
            </Button>
          </div>
        ) : !history.data ? (
          <p className="surface p-8 text-center text-sm text-muted-foreground" role="status">
            {t("group.loading")}
          </p>
        ) : (
          <>
            {history.isError && (
              <div className="surface px-4 py-3 flex flex-wrap items-center justify-between gap-3" role="alert">
                <p className="text-xs text-destructive">{t("group.historyFailed")}</p>
                <button
                  type="button"
                  className="text-xs underline underline-offset-2 text-muted-foreground hover:text-foreground"
                  onClick={() => void history.refetch()}
                >
                  {t("group.retry")}
                </button>
              </div>
            )}

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_15rem]">
              <div className="space-y-3 min-w-0">
                <section
                  className="surface p-4 sm:p-5 flex flex-col gap-4 min-h-72"
                  aria-label={room?.name ?? t("group.title")}
                >
                  {messages.length === 0 ? (
                    <p className="m-auto text-sm text-muted-foreground">{t("group.empty")}</p>
                  ) : (
                    messages.map((message) => {
                      const mine = message.role === "user";
                      const name = nameFor(message);
                      return (
                        <article
                          key={message.id}
                          className={`flex items-start gap-2.5 ${mine ? "flex-row-reverse" : ""}`}
                          data-role={message.role}
                        >
                          <PersonaAvatar
                            name={name || "?"}
                            url={avatarFor(message)}
                            className="w-8 h-8 rounded-full text-xs flex-shrink-0"
                          />
                          <div
                            className={`flex max-w-[78%] min-w-0 flex-col gap-0.5 ${mine ? "items-end text-right" : "items-start"}`}
                          >
                            <p className="text-[11px] text-muted-foreground">{name}</p>
                            <div
                              className={`px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words ${
                                mine ? "bubble-user" : "bubble-ai"
                              }`}
                            >
                              {message.content}
                            </div>
                          </div>
                        </article>
                      );
                    })
                  )}
                </section>

                {/* The composer */}
                <div className="surface p-3 space-y-2">
                  {crisisText && (
                    <div
                      role="alert"
                      data-testid="group-crisis"
                      className="surface border-destructive/40 bg-destructive/5 p-4"
                    >
                      <p className="font-display text-sm font-semibold text-destructive mb-2">
                        {t("safety.crisisTitle")}
                      </p>
                      <p className="text-sm text-foreground/85 leading-relaxed whitespace-pre-wrap">
                        {crisisText}
                      </p>
                    </div>
                  )}

                  {sendFailed && (
                    <p role="alert" className="text-xs text-destructive">
                      {t("group.sendFailed")}
                    </p>
                  )}

                  {mentionOpen && (
                    <ul
                      aria-label={t("group.mentionHint")}
                      data-testid="group-mention-list"
                      className="surface max-h-40 overflow-y-auto p-1"
                    >
                      {mentionMatches.length === 0 ? (
                        <li className="px-2 py-1.5 text-xs text-muted-foreground">
                          {t("group.noGroupData")}
                        </li>
                      ) : (
                        mentionMatches.map((member) => (
                          <li key={member.personaId}>
                            <button
                              type="button"
                              onClick={() => pickMention(member.name)}
                              className="w-full rounded-sm px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted/60 transition-colors"
                            >
                              {member.name}
                            </button>
                          </li>
                        ))
                      )}
                    </ul>
                  )}

                  <form onSubmit={onSubmit} className="flex items-center gap-2">
                    <Input
                      ref={inputRef}
                      value={text}
                      onChange={(event) => setText(event.target.value)}
                      placeholder={t("group.inputPlaceholder")}
                      aria-label={t("group.inputPlaceholder")}
                      className="flex-1"
                    />
                    <Button type="submit" disabled={!text.trim() || send.isPending}>
                      <Send className="w-3.5 h-3.5" />
                      {t("group.send")}
                    </Button>
                  </form>
                  <p className="text-[11px] text-muted-foreground">{t("group.mentionHint")}</p>
                </div>
              </div>

              {/* Who is in the room */}
              <aside
                className="surface p-4 space-y-2.5 self-start"
                aria-label={t("group.membersTitle")}
                data-testid="group-members"
              >
                <div>
                  <h2 className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                    <Users className="w-3.5 h-3.5 text-muted-foreground" />
                    {t("group.membersTitle")}
                  </h2>
                  <p className="kicker mt-0.5">{t("group.memberCount", { count: members.length })}</p>
                </div>
                <ul className="space-y-2.5">
                  {members.map((member) => (
                    <li key={member.personaId} className="flex items-start gap-2" data-unavailable={!member.available}>
                      <PersonaAvatar
                        name={member.name}
                        url={member.avatarUrl}
                        className="w-7 h-7 rounded-full text-[11px] flex-shrink-0"
                      />
                      <div className="min-w-0">
                        <p
                          className={`text-sm leading-tight ${member.available ? "text-foreground" : "text-muted-foreground"}`}
                        >
                          {member.name}
                        </p>
                        {!member.hasGroupData && (
                          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                            {t("group.noGroupData")}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </aside>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
