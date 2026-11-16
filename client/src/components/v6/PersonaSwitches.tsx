import { useLocale } from "@/contexts/LocaleContext";

/**
 * The per-persona switches for the sixth stage.
 *
 * Empty on purpose: later entries each add one row. The heading and the
 * note are already the ones those rows will sit under.
 */
export default function PersonaSwitches() {
  const { t } = useLocale();
  return (
    <div className="space-y-1.5">
      <p className="kicker">{t("personaEdit.switchesTitle")}</p>
      <p className="text-xs text-muted-foreground leading-relaxed">
        {t("personaEdit.switchesHint")}
      </p>
    </div>
  );
}
