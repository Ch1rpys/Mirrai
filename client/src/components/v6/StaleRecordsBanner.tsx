import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/contexts/LocaleContext";

/**
 * New records landed after the persona was distilled.
 *
 * The persona is still the one built from the earlier set. The button
 * starts a full distillation until incremental rebuild exists.
 */
export default function StaleRecordsBanner(props: {
  added: number;
  pending?: boolean;
  onRebuild: () => void;
}) {
  const { t } = useLocale();
  if (props.added <= 0) return null;

  return (
    <div className="surface p-5 sm:p-6 mb-6 animate-fade-in-up">
      <p className="text-sm text-foreground leading-relaxed">
        {t("upload.staleRecordsBanner", { added: props.added })}
      </p>
      <Button
        className="mt-3 rounded-md"
        disabled={props.pending}
        onClick={props.onRebuild}
      >
        {props.pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
        {t("upload.staleRecordsNow")}
      </Button>
    </div>
  );
}
