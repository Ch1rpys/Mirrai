import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/contexts/LocaleContext";
import { trpc } from "@/lib/trpc";

/**
 * The printable summary for a counsellor (C4.6).
 *
 * The dialog asks for a range and two opt-ins. Both opt-ins default to
 * off, and the note above says what the file has and has not: curves and
 * dates by default, no conversation, and the replica's words never — the
 * summary is about the person, not about the persona.
 */
export default function CounselorExport() {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState<"30d" | "90d" | "all">("30d");
  const [includeThemes, setIncludeThemes] = useState(false);
  const [includeJournal, setIncludeJournal] = useState(false);
  const [failed, setFailed] = useState(false);

  const build = trpc.user.exportCounselorSummary.useMutation({
    onSuccess: (data) => {
      const blob = new Blob([data.html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      // Give the new tab a moment to take the URL before releasing it.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setOpen(false);
      setFailed(false);
    },
    onError: () => setFailed(true),
  });

  return (
    <section className="surface p-5 sm:p-6 space-y-3">
      <div>
        <h3 className="font-display text-sm font-semibold text-foreground">
          {t("counselor.title")}
        </h3>
        <p className="text-xs text-muted-foreground leading-relaxed mt-1">{t("counselor.note")}</p>
      </div>
      {!open ? (
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          {t("counselor.open")}
        </Button>
      ) : (
        <div className="space-y-3" role="dialog" aria-label={t("counselor.title")}>
          <div className="space-y-1">
            <p className="text-[11px] text-muted-subtle">{t("counselor.range")}</p>
            <div className="flex flex-wrap gap-2">
              {(["30d", "90d", "all"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={range === value}
                  onClick={() => setRange(value)}
                  className={`rounded-md border px-2.5 py-1 text-xs ${
                    range === value
                      ? "border-foreground/40 text-foreground"
                      : "border-border text-muted-foreground"
                  }`}
                >
                  {value === "30d"
                    ? t("counselor.range30")
                    : value === "90d"
                      ? t("counselor.range90")
                      : t("counselor.rangeAll")}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs text-foreground/85">
            <input
              type="checkbox"
              checked={includeThemes}
              onChange={(event) => setIncludeThemes(event.target.checked)}
            />
            {t("counselor.includeThemes")}
          </label>
          <label className="flex items-center gap-2 text-xs text-foreground/85">
            <input
              type="checkbox"
              checked={includeJournal}
              onChange={(event) => setIncludeJournal(event.target.checked)}
            />
            {t("counselor.includeJournal")}
          </label>
          {failed ? <p className="text-xs text-destructive" role="alert">{t("common.error")}</p> : null}
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={build.isPending}
              onClick={() => build.mutate({ range, includeThemes, includeJournal })}
            >
              {t("counselor.build")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
