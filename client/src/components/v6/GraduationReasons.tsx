import { useState } from "react";
import { Check, Minus } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";

/**
 * Why the app suggests a goodbye (C4.3).
 *
 * The list is the conditions the check actually uses — the same array the
 * boolean is computed from — so the page cannot explain one decision and
 * the app make another. No total, no percentage, no progress bar: each
 * row is a fact and whether it is met.
 */
export default function GraduationReasons({ personaId }: { personaId?: number }) {
  const { t } = useLocale();
  const personas = trpc.persona.list.useQuery(undefined, { enabled: personaId === undefined });
  const [picked, setPicked] = useState<number | null>(null);
  const options = (personas.data ?? []) as Array<{ id: number; name: string }>;
  const activeId = personaId ?? picked ?? options[0]?.id ?? 0;
  const check = trpc.persona.checkGraduation.useQuery(
    { id: activeId },
    { enabled: activeId > 0 },
  );
  const recent = trpc.checkin.recent.useQuery(
    { personaId: activeId },
    { enabled: activeId > 0 },
  );

  const conditions = check.data?.conditions ?? [];

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="section-title">{t("graduationReasons.title")}</h2>
        {personaId === undefined && options.length > 1 ? (
          <select
            aria-label={t("graduationReasons.persona")}
            value={activeId}
            onChange={(event) => setPicked(Number(event.target.value))}
            className="h-8 rounded-md border border-input bg-card px-2 text-xs text-foreground"
          >
            {options.map((persona) => (
              <option key={persona.id} value={persona.id}>{persona.name}</option>
            ))}
          </select>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{t("graduationReasons.note")}</p>

      {check.isLoading ? (
        <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
      ) : check.isError ? (
        <p className="text-xs text-muted-foreground">{t("common.error")}</p>
      ) : conditions.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("graduationReasons.empty")}</p>
      ) : (
        <ul className="space-y-2">
          {conditions.map((condition: any) => (
            <li key={condition.key} className="flex items-start gap-2 rounded-lg border border-border/60 p-3">
              <span className={`mt-0.5 ${condition.met ? "text-foreground" : "text-muted-subtle"}`}>
                {condition.met ? <Check className="w-3.5 h-3.5" /> : <Minus className="w-3.5 h-3.5" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-foreground/90">
                  {t(`graduationReasons.condition.${condition.key}` as never)}
                </p>
                <p className="text-[11px] text-muted-subtle mt-0.5">
                  {condition.detail} · {condition.met ? t("graduationReasons.met") : t("graduationReasons.notMet")}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {(recent.data?.answers ?? []).length > 0 ? (
        <div className="space-y-1">
          <p className="text-[11px] text-muted-subtle">{t("graduationReasons.yourAnswers")}</p>
          <div className="flex flex-wrap gap-1.5">
            {(recent.data?.answers ?? []).slice(0, 3).map((answer: any, index: number) => (
              <span key={index} className="rounded-sm bg-muted/60 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                {answer.answer === "better"
                  ? t("afterChat.better")
                  : answer.answer === "same"
                    ? t("afterChat.same")
                    : answer.answer === "worse"
                      ? t("afterChat.worse")
                      : t("afterChat.skipped")}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
