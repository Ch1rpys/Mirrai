import { useState } from "react";
import { PenLine, Trash2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { useConfirm } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { formatDayKey } from "@/lib/dates";
import CrisisCard from "@/components/CrisisCard";
import { toast } from "sonner";

/**
 * The user's own diary (C4.5).
 *
 * Not the app's summary of a conversation: the words the person wrote
 * themselves. The panel says where they stay, because "did a model read
 * this" is a fair question to ask of anything in this app — and the
 * answer here is no.
 */
export default function MyJournal({ personaId }: { personaId?: number }) {
  const { t, locale } = useLocale();
  const confirm = useConfirm();
  const utils = trpc.useUtils();
  const { data, isLoading, isError, refetch } = trpc.journal.list.useQuery(
    personaId ? { personaId } : {},
  );
  const [crisisOpen, setCrisisOpen] = useState(false);
  const create = trpc.journal.create.useMutation({
    onSuccess: (result: { crisis?: boolean }) => {
      /**
       * The words are read before they are kept (WP12's rule, C4.5). A
       * hit shows the card and the entry is not written; the draft is
       * left where it is, so nothing the person wrote disappears.
       */
      if (result?.crisis) {
        setCrisisOpen(true);
        return;
      }
      setDraft("");
      utils.journal.list.invalidate();
      toast.success(t("myJournal.saved"));
    },
    onError: (e) => toast.error(e.message),
  });
  const update = trpc.journal.update.useMutation({
    onSuccess: (result: { crisis?: boolean }) => {
      if (result?.crisis) {
        setCrisisOpen(true);
        return;
      }
      setEditing(null);
      utils.journal.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const remove = trpc.journal.delete.useMutation({
    onSuccess: () => utils.journal.list.invalidate(),
    onError: (e) => toast.error(e.message),
  });
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [editBody, setEditBody] = useState("");
  const [older, setOlder] = useState<any[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null | undefined>(undefined);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const next = nextCursor === undefined ? (data?.next ?? null) : nextCursor;

  const entries = [...(data?.entries ?? []), ...older];

  async function loadOlder() {
    if (next == null || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await utils.journal.list.fetch({
        ...(personaId ? { personaId } : {}),
        cursor: next,
      });
      setOlder((current) => {
        const seen = new Set(current.map((entry: any) => entry.id));
        return [...current, ...page.entries.filter((entry: any) => !seen.has(entry.id))];
      });
      setNextCursor(page.next ?? null);
    } finally {
      setLoadingOlder(false);
    }
  }

  return (
    <section className="space-y-4">
      {crisisOpen ? <CrisisCard onClose={() => setCrisisOpen(false)} /> : null}
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="section-title">{t("myJournal.title")}</h2>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{t("myJournal.hint")}</p>

      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          const body = draft.trim();
          if (!body) return;
          create.mutate({ body, ...(personaId ? { personaId } : {}) });
        }}
      >
        <Label className="sr-only" htmlFor="journal-new">{t("myJournal.placeholder")}</Label>
        <Textarea
          id="journal-new"
          value={draft}
          rows={3}
          maxLength={20_000}
          placeholder={t("myJournal.placeholder")}
          onChange={(event) => setDraft(event.target.value)}
        />
        <p className="text-[11px] text-muted-subtle">{t("myJournal.privacyNote")}</p>
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={!draft.trim() || create.isPending}>
            <PenLine className="w-3.5 h-3.5" />
            {t("myJournal.save")}
          </Button>
        </div>
      </form>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
      ) : isError ? (
        <div className="flex items-center gap-2">
          <p className="text-xs text-muted-foreground">{t("common.error")}</p>
          <button
            type="button"
            onClick={() => refetch()}
            className="text-xs underline underline-offset-2 text-muted-foreground hover:text-foreground"
          >
            {t("common.retry")}
          </button>
        </div>
      ) : entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("myJournal.empty")}</p>
      ) : (
        <ul className="space-y-3">
          {entries.map((entry: any) => (
            <li key={entry.id} className="rounded-xl border border-border/70 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-muted-subtle">
                  {formatDayKey(entry.entryDate, locale)}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={t("myJournal.edit")}
                    onClick={() => { setEditing(entry.id); setEditBody(entry.body); }}
                    className="p-1 text-muted-subtle hover:text-foreground"
                  >
                    <PenLine className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={t("myJournal.delete")}
                    onClick={async () => {
                      const yes = await confirm({ description: t("myJournal.deleteConfirm") });
                      if (yes) remove.mutate({ id: entry.id });
                    }}
                    className="p-1 text-muted-subtle hover:text-destructive"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              {editing === entry.id ? (
                <div className="space-y-2">
                  <Textarea value={editBody} rows={4} onChange={(event) => setEditBody(event.target.value)} />
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                      {t("microRules.cancel")}
                    </Button>
                    <Button
                      size="sm"
                      disabled={!editBody.trim() || update.isPending}
                      onClick={() => update.mutate({ id: entry.id, body: editBody.trim() })}
                    >
                      {t("microRules.save")}
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                  {entry.body}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {next != null ? (
        <div className="flex justify-center">
          <Button size="sm" variant="ghost" onClick={loadOlder} disabled={loadingOlder}>
            {loadingOlder ? t("common.loading") : t("myJournal.loadOlder")}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
