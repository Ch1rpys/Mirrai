import { useLocale } from "@/contexts/LocaleContext";
import { normalizeRituals } from "@shared/ritual-table";

/**
 * The short replies they almost always gave to the same short line.
 *
 * Read-only: the table is measured, then used as-is. Editing it is a
 * later question; this page only shows what was found.
 */
export default function RitualsView({ rituals }: { rituals?: unknown }) {
  const { t } = useLocale();
  const rows = normalizeRituals(rituals);
  if (rows.length === 0) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium">{t("fidelity.rituals.title")}</h3>
      <ul className="space-y-2 text-sm leading-relaxed">
        {rows.map((entry) => (
          <li key={entry.trigger} data-testid={`ritual-${entry.trigger}`}>
            <span className="font-medium">{entry.trigger}</span>
            <span className="block text-xs text-muted-foreground mt-0.5">
              {entry.replies
                .map((reply) => String(t("fidelity.rituals.reply", { text: reply.text, n: reply.n })))
                .join(String(t("fidelity.rituals.sep")))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
