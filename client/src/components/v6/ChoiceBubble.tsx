import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { toast } from "sonner";

/**
 * Two unreplied lines, side by side.
 *
 * The persona offered both. Picking one stores it as the reply and
 * writes a training pair. Sending another message instead takes the
 * first line, and that is the server's job.
 */
export default function ChoiceBubble(props: {
  personaId: number;
  personaName: string;
  replyToMessageId: number;
  options: [string, string];
  onPicked?: (result: { messageId: number; content: string; emotionalState: string }) => void;
}) {
  const { t } = useLocale();
  const choose = trpc.fidelity.choose.useMutation({
    onError: (error) => toast.error(error.message),
  });

  const pick = (index: 0 | 1) => {
    if (choose.isPending) return;
    const chosen = props.options[index];
    const rejected = props.options[index === 0 ? 1 : 0];
    choose.mutate(
      {
        personaId: props.personaId,
        replyToMessageId: props.replyToMessageId,
        chosen,
        rejected,
      },
      {
        onSuccess: (result) => {
          props.onPicked?.({
            messageId: result.messageId,
            content: chosen,
            emotionalState: result.emotionalState,
          });
        },
      },
    );
  };

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <p className="text-xs text-muted-foreground">
        {t("choice.title", { name: props.personaName })}
      </p>
      <div className="grid grid-cols-2 gap-2">
        {props.options.map((line, index) => (
          <button
            key={index}
            type="button"
            disabled={choose.isPending}
            onClick={() => pick(index as 0 | 1)}
            className="rounded-md border border-border bg-card px-3 py-2 text-left text-sm leading-relaxed whitespace-pre-wrap hover:border-ring disabled:opacity-40"
          >
            {line}
          </button>
        ))}
      </div>
    </div>
  );
}
