import { formatTimeInZone } from "@/lib/dates";

/** Five minutes. Adjacent messages further apart than this get a bar. */
export const TIME_BAR_GAP_MS = 5 * 60_000;

/**
 * The centred time between two messages (B7.15).
 *
 * The classic layout already shows times its own way, so this returns
 * nothing there. The two IM layouts draw it only when the gap is more
 * than five minutes.
 */
export default function TimeBar({
  at,
  previousAt,
  skin,
  locale,
  timeZone,
}: {
  at: Date | string | null | undefined;
  previousAt?: Date | string | null;
  skin: string;
  locale: "zh" | "en";
  timeZone?: string | null;
}) {
  if (skin === "classic") return null;
  if (!at) return null;
  /**
   * The bar sits *between* two messages, so the first message of the
   * thread has no bar: there is no gap to mark yet.
   */
  if (!previousAt) return null;
  const current = new Date(at).getTime();
  if (Number.isNaN(current)) return null;
  const previous = new Date(previousAt).getTime();
  if (!Number.isNaN(previous) && current - previous <= TIME_BAR_GAP_MS) return null;
  return (
    <div className="time-bar hidden justify-center my-2" role="separator">
      <span>{formatTimeInZone(at, locale, timeZone)}</span>
    </div>
  );
}
