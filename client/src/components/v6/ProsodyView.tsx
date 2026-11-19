import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { normalizeProsody } from "@shared/prosody";
import { Button } from "@/components/ui/button";

/**
 * How fast they talk, and how they pause.
 *
 * The numbers are measured from the recorded voice notes that have a
 * transcript. The trailing silence is shown and not used: none of the
 * three read-aloud engines takes it, and a number that changes nothing
 * would still be read as a promise.
 */
export default function ProsodyView(props: {
  personaId: number;
  name: string;
  prosody?: unknown;
}) {
  const { t } = useLocale();
  const utils = trpc.useUtils();
  const [failed, setFailed] = useState(false);
  const measure = trpc.media.measureProsody.useMutation({
    onSuccess: (data) => {
      setFailed(!data.prosody);
      void utils.persona.get.invalidate();
    },
    onError: () => setFailed(true),
  });
  const prosody = normalizeProsody(props.prosody);

  return (
    <section className="space-y-2">
      <h2 className="section-title">{t("prosody.title", { name: props.name })}</h2>
      <p className="text-xs text-muted-foreground leading-relaxed">
        {t("prosody.note")}
      </p>
      {prosody ? (
        <dl className="grid grid-cols-1 gap-1.5 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-subtle">{t("prosody.rate")}</dt>
            <dd>{t("prosody.rateValue", { n: prosody.charsPerSec.toFixed(2) })}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-subtle">{t("prosody.pause")}</dt>
            <dd>
              {prosody.pauseRatio == null
                ? t("prosody.notMeasured")
                : t("prosody.pauseValue", { n: Math.round(prosody.pauseRatio * 100) })}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-subtle">{t("prosody.tail")}</dt>
            <dd>
              {prosody.tailSec == null
                ? t("prosody.notMeasured")
                : t("prosody.tailValue", { n: prosody.tailSec.toFixed(1) })}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t("prosody.empty", { name: props.name })}
        </p>
      )}
      <p className="text-[11px] text-muted-subtle leading-relaxed">{t("prosody.tailNote")}</p>
      <div className="space-y-1.5">
        <Button
          size="sm"
          variant="outline"
          disabled={measure.isPending}
          onClick={() => measure.mutate({ personaId: props.personaId })}
        >
          {measure.isPending ? t("prosody.measuring") : t("prosody.measure")}
        </Button>
        {failed && (
          <p className="text-xs text-muted-foreground">{t("prosody.tooFew")}</p>
        )}
      </div>
    </section>
  );
}
