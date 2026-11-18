import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { toast } from "sonner";

type Sampling = {
  temperature: number;
  topP: number;
  presencePenalty: number;
  frequencyPenalty: number;
};

const DEFAULTS: Sampling = {
  temperature: 0.8,
  topP: 1,
  presencePenalty: 0,
  frequencyPenalty: 0,
};

/**
 * Per-persona sampling, under the switches.
 *
 * Empty means the global extraConfig values. Saving writes the four
 * numbers; clearing drops the object so the global ones come back.
 */
export default function PersonaSampling(props: { personaId: number }) {
  const { t } = useLocale();
  const settings = trpc.persona.getSettings.useQuery(
    { id: props.personaId },
    { enabled: props.personaId > 0 },
  );
  const update = trpc.persona.updateSettings.useMutation({
    onSuccess: () => settings.refetch(),
    onError: (error) => toast.error(error.message),
  });
  const [sampling, setSampling] = useState<Sampling>(DEFAULTS);

  useEffect(() => {
    const saved = settings.data?.sampling;
    setSampling({
      temperature: saved?.temperature ?? DEFAULTS.temperature,
      topP: saved?.topP ?? DEFAULTS.topP,
      presencePenalty: saved?.presencePenalty ?? DEFAULTS.presencePenalty,
      frequencyPenalty: saved?.frequencyPenalty ?? DEFAULTS.frequencyPenalty,
    });
  }, [settings.data]);

  const busy = settings.isLoading || update.isPending;

  return (
    <div className="space-y-3 pt-3">
      <p className="kicker">{t("personaEdit.samplingTitle")}</p>
      <p className="text-xs text-muted-foreground leading-relaxed">
        {t("personaEdit.samplingNote")}
      </p>
      <SamplingSlider
        label={t("personaEdit.samplingTemperature")}
        value={sampling.temperature}
        min={0}
        max={2}
        step={0.1}
        disabled={busy}
        onChange={(temperature) => setSampling((current) => ({ ...current, temperature }))}
      />
      <SamplingSlider
        label={t("personaEdit.samplingTopP")}
        value={sampling.topP}
        min={0}
        max={1}
        step={0.05}
        disabled={busy}
        onChange={(topP) => setSampling((current) => ({ ...current, topP }))}
      />
      <SamplingSlider
        label={t("personaEdit.samplingPresence")}
        value={sampling.presencePenalty}
        min={-2}
        max={2}
        step={0.1}
        disabled={busy}
        onChange={(presencePenalty) => setSampling((current) => ({ ...current, presencePenalty }))}
      />
      <SamplingSlider
        label={t("personaEdit.samplingFrequency")}
        value={sampling.frequencyPenalty}
        min={-2}
        max={2}
        step={0.1}
        disabled={busy}
        onChange={(frequencyPenalty) => setSampling((current) => ({ ...current, frequencyPenalty }))}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          className="rounded-md px-5"
          disabled={busy}
          onClick={() =>
            update.mutate(
              { id: props.personaId, patch: { sampling } },
              { onSuccess: () => toast.success(t("personaEdit.samplingSaved")) },
            )
          }
        >
          {update.isPending ? t("common.saving") : t("personaEdit.samplingSave")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="rounded-md px-5"
          disabled={busy}
          onClick={() =>
            update.mutate(
              { id: props.personaId, patch: { sampling: null } },
              { onSuccess: () => toast.success(t("personaEdit.samplingCleared")) },
            )
          }
        >
          {t("personaEdit.samplingClear")}
        </Button>
      </div>
    </div>
  );
}

function SamplingSlider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm text-foreground/80">{props.label}</Label>
        <span className="stat-value text-sm">{props.value}</span>
      </div>
      <Slider
        aria-label={props.label}
        value={[props.value]}
        onValueChange={(next) => props.onChange(next[0] ?? props.value)}
        min={props.min}
        max={props.max}
        step={props.step}
        disabled={props.disabled}
      />
    </div>
  );
}
