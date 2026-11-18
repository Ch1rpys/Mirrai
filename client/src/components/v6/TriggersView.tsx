import { useLocale } from "@/contexts/LocaleContext";
import { copy } from "@shared/copy";
import { normalizeTriggers } from "@shared/conflicts";
import { USER_ACT_COPY_KEYS } from "@shared/speech-acts";
import { zonedDateKey } from "@shared/timezone";

/**
 * The user-acts that used to precede a freeze.
 *
 * Read-only: counted from the records, not a judgement. Expanding a
 * row shows the original lines and the days they were said.
 */
export default function TriggersView({
  name,
  triggers,
  timeZone,
}: {
  name: string;
  triggers?: unknown;
  /** TA's zone, then the user's. Dates are that calendar day, not UTC. */
  timeZone?: string | null;
}) {
  const { t, locale } = useLocale();
  const rows = normalizeTriggers(triggers) ?? [];
  if (rows.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="section-title">{t("profile.triggersTitle", { name })}</h2>
      <p className="text-xs text-muted-foreground leading-relaxed">{t("profile.triggersNote")}</p>
      <ul className="space-y-2 text-sm leading-relaxed">
        {rows.map((entry) => {
          const label = copy(locale, USER_ACT_COPY_KEYS[entry.userAct]);
          return (
            <li key={`${entry.userAct}:${entry.to}`}>
              <details>
                <summary className="cursor-pointer">
                  {t("profile.triggersRow", { label, n: entry.n })}
                </summary>
                <ul className="mt-1 space-y-1 text-xs text-muted-foreground pl-4">
                  {entry.examples.map((example, index) => (
                    <li key={`${example.recordId ?? index}:${example.text}`}>
                      <span>{example.text}</span>
                      {example.at ? (
                        <span className="ml-2">{zonedDateKey(new Date(example.at), timeZone)}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
