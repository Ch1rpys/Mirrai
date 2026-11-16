import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/contexts/LocaleContext";

/**
 * Old uploaded chat files that have never been turned into records.
 *
 * The import is not run on upgrade — a file may need the user to say
 * who is who — so the upload page offers the pass instead.
 */
export default function BackfillBanner(props: {
  count: number;
  pending?: boolean;
  onBackfill: () => void;
}) {
  const { t } = useLocale();
  if (props.count <= 0) return null;

  return (
    <div className="surface p-5 sm:p-6 mb-6 animate-fade-in-up">
      <p className="text-sm text-foreground leading-relaxed">
        {t("upload.backfillBanner", { count: props.count })}
      </p>
      <Button
        className="mt-3 rounded-md"
        disabled={props.pending}
        onClick={props.onBackfill}
      >
        {props.pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
        {t("upload.backfillNow")}
      </Button>
    </div>
  );
}
