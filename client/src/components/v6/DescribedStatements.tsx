import { useLocale } from "@/contexts/LocaleContext";
import type { DescribedStatement } from "@shared/described";

/**
 * What the user (and their family) described (C1.8).
 *
 * A persona with no records has no measured portrait — every sentence it
 * knows was told by somebody. Each line carries the marker that says so,
 * and the quote it was made from: the user can always see what the
 * sentence stands on.
 *
 * The marker is 「来自你的描述」 for the user's own words, and names the
 * teller for a family member's (C7.4).
 */
export default function DescribedStatements({
  statements,
  name,
  ownName,
}: {
  statements: DescribedStatement[];
  name: string;
  /** The reader's own display name, so their words read as theirs. */
  ownName?: string;
}) {
  const { t } = useLocale();
  if (!statements.length) return null;
  const own = String(ownName ?? "").trim();
  return (
    <section className="surface p-5 sm:p-6 mb-6" data-testid="described-statements">
      <h2 className="section-title">{t("profile.describedTitle", { name })}</h2>
      <p className="text-xs text-muted-foreground mt-1 mb-4 leading-relaxed">
        {t("profile.describedNote")}
      </p>
      <ul className="space-y-3">
        {statements.map((statement, index) => {
          const teller = String(statement.teller ?? "").trim();
          const marker =
            !teller || (own && teller === own)
              ? t("profile.described")
              : t("profile.describedBy", { teller });
          return (
            <li key={`${statement.field ?? "personality"}-${index}`} className="text-sm">
              <p className="text-foreground/90 leading-relaxed">
                {statement.text}{" "}
                <span
                  className="ml-1 inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground align-middle"
                  data-testid="described-marker"
                >
                  {marker}
                </span>
              </p>
              <p className="text-xs text-muted-subtle mt-1 leading-relaxed" title={statement.quote}>
                「{statement.quote}」
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
