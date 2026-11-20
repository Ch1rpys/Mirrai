/**
 * Their letter, and the user's (C6.5).
 *
 * The farewell letter is written by the persona. What the user wanted to
 * say was nowhere on the page, so the two letters sit side by side: the
 * one the persona wrote, and one the user chose from their exit list or
 * wrote here. Reading them next to each other is the whole feature —
 * nothing is sent, and the two letters are not merged into one.
 */
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export default function MutualLetters({
  personaId,
  name,
  theirLetter,
}: {
  personaId: number;
  name: string;
  theirLetter: string;
}) {
  const { t } = useLocale();
  const list = trpc.outbound.list.useQuery({ personaId });
  const utils = trpc.useUtils();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [written, setWritten] = useState<string | null>(null);

  const letters = useMemo(
    () => (list.data?.letters ?? []).filter((letter: any) => letter.text?.trim()),
    [list.data],
  );
  const selected = letters.find((letter: any) => letter.id === selectedId) ?? null;

  const addOwn = trpc.outbound.addOwn.useMutation({
    onSuccess: () => {
      setWritten(draft.trim());
      setDraft("");
      utils.outbound.list.invalidate({ personaId });
    },
  });

  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-subtle mb-2">
          {t("mutualLetters.theirLabel", { name })}
        </p>
        <p className="text-[0.9375rem] leading-[1.9] whitespace-pre-wrap text-foreground/90">
          {theirLetter}
        </p>
      </div>
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-subtle mb-2">
          {t("mutualLetters.yourLabel")}
        </p>
        {letters.length > 0 && (
          <select
            aria-label={t("mutualLetters.pick")}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs mb-2"
            value={selectedId ?? ""}
            onChange={(event) =>
              setSelectedId(event.target.value ? Number(event.target.value) : null)
            }
          >
            <option value="">{t("mutualLetters.pick")}</option>
            {letters.map((letter: any) => (
              <option key={letter.id} value={letter.id}>
                {letter.text.length > 24 ? `${letter.text.slice(0, 24)}…` : letter.text}
              </option>
            ))}
          </select>
        )}
        {selected ? (
          <p className="text-[0.9375rem] leading-[1.9] whitespace-pre-wrap text-foreground/90">
            {selected.text}
          </p>
        ) : written ? (
          <p className="text-[0.9375rem] leading-[1.9] whitespace-pre-wrap text-foreground/90">
            {written}
          </p>
        ) : (
          <div className="space-y-2">
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={t("mutualLetters.placeholder", { name })}
              rows={5}
              className="text-sm"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!draft.trim() || addOwn.isPending}
              onClick={() => addOwn.mutate({ personaId, text: draft.trim() })}
            >
              {t("mutualLetters.save")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
