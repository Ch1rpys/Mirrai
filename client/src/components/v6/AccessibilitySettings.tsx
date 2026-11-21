import { useTheme, FONT_SCALES, type FontScale } from "@/contexts/ThemeContext";
import { useLocale } from "@/contexts/LocaleContext";

/**
 * The 外观 panel: text size, contrast, motion.
 *
 * The settings are device settings, not account settings — somebody reading
 * the app on a phone with the sun on the screen and somebody reading it on a
 * desktop at night want different things — so they live in the browser and
 * apply through `ThemeContext` to `<html>`. The three controls here are the
 * only thing that writes them.
 *
 * The font sizes are shown as three buttons rather than a slider: there are
 * three allowed values (`1`, `1.125`, `1.25`), a slider would show positions
 * that mean nothing, and a button is one tap with a name a screen reader can
 * read out.
 */

/** The dictionary key of each font size, in the order they are offered. */
const SCALE_KEYS: Record<FontScale, string> = {
  1: "accessibility.fontScaleDefault",
  1.125: "accessibility.fontScaleLarge",
  1.25: "accessibility.fontScaleLargest",
};

/** The class of a selected control. */
const SELECTED = "border-cinnabar bg-cinnabar/10 text-foreground font-medium";
const UNSELECTED = "border-border text-muted-foreground hover:text-foreground";

export default function AccessibilitySettings() {
  const { t } = useLocale();
  const {
    fontScale,
    contrast,
    reduceMotion,
    setFontScale,
    setContrast,
    setReduceMotion,
  } = useTheme();

  return (
    <section className="surface p-5 sm:p-6" data-testid="accessibility-settings">
      <h2 className="font-display text-lg sm:text-xl font-semibold text-foreground">
        {t("accessibility.title")}
      </h2>
      <p className="kicker mt-1.5 mb-5">{t("accessibility.note")}</p>

      <div className="space-y-5">
        <div>
          <h3 className="text-sm font-medium text-foreground mb-2">
            {t("accessibility.fontScale")}
          </h3>
          <div
            role="group"
            aria-label={t("accessibility.fontScale")}
            className="flex flex-wrap gap-2"
          >
            {FONT_SCALES.map((scale) => (
              <button
                key={scale}
                type="button"
                aria-pressed={fontScale === scale}
                onClick={() => setFontScale(scale)}
                className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                  fontScale === scale ? SELECTED : UNSELECTED
                }`}
              >
                {t(SCALE_KEYS[scale] as "accessibility.fontScaleDefault")}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 id="a11y-contrast-label" className="text-sm font-medium text-foreground">
              {t("accessibility.contrast")}
            </h3>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              {t("accessibility.contrastNote")}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={contrast}
            aria-labelledby="a11y-contrast-label"
            onClick={() => setContrast(!contrast)}
            className={`relative h-6 w-11 flex-shrink-0 rounded-full border transition-colors ${
              contrast ? "bg-cinnabar border-cinnabar" : "bg-muted border-border"
            }`}
          >
            <span
              aria-hidden="true"
              className={`absolute top-0.5 h-4 w-4 rounded-full bg-background transition-transform ${
                contrast ? "left-6" : "left-1"
              }`}
            />
          </button>
        </div>

        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 id="a11y-motion-label" className="text-sm font-medium text-foreground">
              {t("accessibility.reduceMotion")}
            </h3>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              {t("accessibility.reduceMotionNote")}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={reduceMotion}
            aria-labelledby="a11y-motion-label"
            onClick={() => setReduceMotion(!reduceMotion)}
            className={`relative h-6 w-11 flex-shrink-0 rounded-full border transition-colors ${
              reduceMotion ? "bg-cinnabar border-cinnabar" : "bg-muted border-border"
            }`}
          >
            <span
              aria-hidden="true"
              className={`absolute top-0.5 h-4 w-4 rounded-full bg-background transition-transform ${
                reduceMotion ? "left-6" : "left-1"
              }`}
            />
          </button>
        </div>
      </div>
    </section>
  );
}
