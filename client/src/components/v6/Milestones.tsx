import { trpc } from "@/lib/trpc";
import { formatInstantInZone } from "@/lib/dates";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLocale } from "@/contexts/LocaleContext";

type LineKey =
  | "lobby.walkedHere.firstLetter"
  | "lobby.walkedHere.firstOutbound"
  | "lobby.walkedHere.firstFarewell";

/**
 * The three things that are not about how much the user chatted.
 *
 * A date and a line for each that has happened. Nothing for the ones
 * that have not — that would be a locked badge waiting to be earned.
 */
export default function Milestones() {
  const { t, locale } = useLocale();
  const { user } = useAuth();
  const timezone = (user as { timezone?: string | null } | null)?.timezone ?? null;
  const query = trpc.user.milestones.useQuery();

  if (query.isError) {
    return (
      <div className="mb-8 border-t border-border pt-5">
        <p className="text-sm text-destructive" role="alert">{t("common.error")}</p>
      </div>
    );
  }

  const data = query.data;
  const items: Array<{ at: string | Date; key: LineKey }> = [];
  if (data?.firstLetterAt) {
    items.push({ at: data.firstLetterAt, key: "lobby.walkedHere.firstLetter" });
  }
  if (data?.firstOutboundSentAt) {
    items.push({ at: data.firstOutboundSentAt, key: "lobby.walkedHere.firstOutbound" });
  }
  if (data?.firstFarewellAt) {
    items.push({ at: data.firstFarewellAt, key: "lobby.walkedHere.firstFarewell" });
  }

  if (query.isLoading || items.length === 0) return null;

  return (
    <div className="mb-8 border-t border-border pt-5">
      <h3 className="card-title mb-3.5">{t("lobby.walkedHere.title")}</h3>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.key} className="text-sm text-foreground/85 leading-relaxed">
            {t(item.key, { date: formatInstantInZone(item.at, locale, timezone) })}
          </li>
        ))}
      </ul>
    </div>
  );
}
