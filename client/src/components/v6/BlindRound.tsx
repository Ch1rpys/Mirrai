import { useEffect, useState } from "react";
import { useLocale } from "@/contexts/LocaleContext";
import { Button } from "@/components/ui/button";
import { FEEDBACK_REASONS, type FeedbackReason } from "@shared/speech-acts";

export type BlindPick = "first" | "second" | "unsure";

/**
 * One pair: two lines, a choice, then an optional reason.
 *
 * The next pair is not the page's problem. This one stays on screen
 * until the choice is in, so a sitter cannot peek at the following
 * lines to decide.
 */
export default function BlindRound({
  first,
  second,
  onSubmit,
  disabled,
}: {
  first: string;
  second: string;
  onSubmit: (pick: BlindPick, reason?: FeedbackReason) => void;
  disabled?: boolean;
}) {
  const { t } = useLocale();
  const [pick, setPick] = useState<BlindPick | null>(null);

  useEffect(() => {
    setPick(null);
  }, [first, second]);

  return (
    <div className="space-y-4">
      <p className="rounded-md border border-border p-3 text-sm leading-relaxed whitespace-pre-wrap">
        {first}
      </p>
      <p className="rounded-md border border-border p-3 text-sm leading-relaxed whitespace-pre-wrap">
        {second}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant={pick === "first" ? "default" : "outline"}
          disabled={disabled}
          onClick={() => setPick("first")}
        >
          {t("fidelity.blind.pickFirst")}
        </Button>
        <Button
          type="button"
          variant={pick === "second" ? "default" : "outline"}
          disabled={disabled}
          onClick={() => setPick("second")}
        >
          {t("fidelity.blind.pickSecond")}
        </Button>
        <Button
          type="button"
          variant={pick === "unsure" ? "default" : "outline"}
          disabled={disabled}
          onClick={() => setPick("unsure")}
        >
          {t("fidelity.blind.pickUnsure")}
        </Button>
      </div>
      {pick ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">{t("fidelity.blind.reasonPrompt")}</p>
          <div className="flex flex-wrap gap-2">
            {FEEDBACK_REASONS.map((reason) => (
              <Button
                key={reason}
                type="button"
                size="sm"
                variant="outline"
                disabled={disabled}
                onClick={() => onSubmit(pick, reason)}
              >
                {t(`chat.unlikeReasons.${reason}` as "chat.unlikeReasons.word")}
              </Button>
            ))}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => onSubmit(pick)}
            >
              {t("fidelity.blind.reasonSkip")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
