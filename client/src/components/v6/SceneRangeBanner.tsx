import { useLocale } from "@/contexts/LocaleContext";
import { formatDayKey } from "@/lib/dates";
import { normalizeSceneRecordRange } from "@shared/scene-range";

/**
 * The line at the top of the chat while a record-range scene is active
 * (C8.13).
 *
 * It says which days the conversation is set in, and that the persona
 * does not know what came after them. It is only shown for a scene that
 * came from *this* persona's record — a scene from another persona is
 * never shown here, and the server refuses to activate one anyway.
 *
 * It reads no data of its own: the persona already carries the active
 * scene id, and the scene list already carries the range.
 */
export default function SceneRangeBanner({
  scene,
  personaId,
  personaName,
}: {
  scene: { recordRange?: unknown } | null | undefined;
  personaId: number;
  /** The name the banner names: the persona's. */
  personaName: string;
}) {
  const { t, locale } = useLocale();
  const range = normalizeSceneRecordRange(scene?.recordRange ?? null);
  if (!range || range.personaId !== personaId) return null;

  return (
    <div className="container max-w-2xl mx-auto px-4 pt-3" data-testid="scene-range-banner">
      <p className="text-xs text-muted-foreground">
        {t("chat.sceneRangeBanner", {
          from: formatDayKey(range.from, locale),
          to: formatDayKey(range.to, locale),
          name: personaName,
        })}
      </p>
    </div>
  );
}
