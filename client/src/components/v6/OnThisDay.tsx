import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { mayFeature, type LobbyPersona } from "@/lib/lobby-eligibility";

/**
 * "On this day" in the hall (C2.1)
 *
 * It shows only when the user opens the hall: no push, no count, no
 * red dot. A persona the hall may not feature keeps it folded.
 */
export interface OnThisDayPersona extends LobbyPersona {
  id: number;
  name: string;
  settings?: { onThisDay?: boolean } | null;
}

export default function OnThisDay({ personas }: { personas: OnThisDayPersona[] }) {
  const { t } = useLocale();
  const persona = personas.find((item) => mayFeature(item)) ?? personas[0];
  const [opened, setOpened] = useState(false);
  const enabled = Boolean(persona) && persona.settings?.onThisDay !== false;
  const query = trpc.record.onThisDay.useQuery(
    { personaId: persona?.id ?? 0 },
    { enabled },
  );
  if (!persona || !enabled) return null;
  const years = query.data ?? [];
  if (years.length === 0) return null;
  const featured = mayFeature(persona);
  const expanded = featured || opened;

  return (
    <section className="mb-8 surface p-5">
      <h2 className="section-title">{t("records.onThisDayTitle")}</h2>
      {!expanded ? (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted-foreground">
            {t("records.onThisDayCollapsed", { n: years.length })}
          </p>
          <button
            type="button"
            className="text-xs underline underline-offset-2"
            onClick={() => setOpened(true)}
          >
            {t("records.onThisDaySee")}
          </button>
        </div>
      ) : (
        <div className="mt-2 space-y-4">
          {years.map((year) => (
            <div key={year.year}>
              <p className="text-xs text-muted-foreground">
                {t("records.onThisDayYear", { year: year.year })}
              </p>
              <div className="mt-1 space-y-0.5">
                {year.rows.map((row) => (
                  <p key={row.id} className="text-sm text-foreground">
                    {row.role === "user" ? t("records.me") : persona.name}：{row.content}
                  </p>
                ))}
              </div>
              <a
                href={`/persona/${persona.id}/records?at=${year.rows[0].id}`}
                className="mt-1 inline-block text-xs underline underline-offset-2"
              >
                {t("records.onThisDayOpen")}
              </a>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
