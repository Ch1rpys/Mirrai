import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import CrisisCard from "@/components/CrisisCard";
import { harmCount, type HarmReport } from "@shared/harm";

const OPTIONS = [
  { value: "remove" as const, key: "harm.remove" as const },
  { value: "soften" as const, key: "harm.soften" as const },
  { value: "keep" as const, key: "harm.keep" as const },
];

/**
 * The choice about hurtful lines found in the record.
 *
 * Distillation only reports them. Whether the replica learns them is
 * the user's, and the default is not to.
 */
export default function HarmNotice(props: {
  personaId: number;
  name: string;
  report: HarmReport | null | undefined;
}) {
  const { t } = useLocale();
  const utils = trpc.useUtils();
  const [showCrisis, setShowCrisis] = useState(false);
  const decide = trpc.persona.decideHarm.useMutation({
    onSuccess: () => {
      void utils.persona.get.invalidate({ id: props.personaId });
    },
  });

  const report = props.report;
  if (!report || report.decision !== "pending") return null;

  const count = harmCount(report);
  const snippets = report.categories.flatMap((row) => row.snippets ?? []).slice(0, 3);
  const here = t("harm.here");
  const footnote = t("harm.footnote");
  const hereAt = footnote.indexOf(here);
  const selected = decide.variables?.decision ?? "remove";

  return (
    <div className="mb-6 rounded-md border border-border bg-muted/30 p-4 sm:p-5 space-y-3">
      <p className="font-sans text-sm font-semibold text-foreground">{t("harm.title")}</p>
      <p className="text-sm text-foreground/85 leading-relaxed">
        {t("harm.body", { name: props.name, count })}
      </p>
      {snippets.length > 0 && (
        <ul className="space-y-1">
          {snippets.map((line, index) => (
            <li key={`${index}:${line}`} className="text-sm text-muted-foreground">
              {line}
            </li>
          ))}
        </ul>
      )}
      <fieldset className="space-y-2" disabled={decide.isPending}>
        <legend className="sr-only">{t("harm.title")}</legend>
        {OPTIONS.map((option) => (
          <label key={option.value} className="flex items-start gap-2 text-sm text-foreground cursor-pointer">
            <input
              type="radio"
              name={`harm-decision-${props.personaId}`}
              value={option.value}
              checked={selected === option.value}
              onChange={() => decide.mutate({ id: props.personaId, decision: option.value })}
              className="mt-1"
            />
            <span>{t(option.key)}</span>
          </label>
        ))}
      </fieldset>
      <p className="text-xs text-muted-foreground leading-relaxed">
        {hereAt >= 0 ? (
          <>
            {footnote.slice(0, hereAt)}
            <button
              type="button"
              className="underline underline-offset-2"
              onClick={() => setShowCrisis(true)}
            >
              {here}
            </button>
            {footnote.slice(hereAt + here.length)}
          </>
        ) : (
          footnote
        )}
      </p>
      {showCrisis && <CrisisCard onClose={() => setShowCrisis(false)} />}
    </div>
  );
}
