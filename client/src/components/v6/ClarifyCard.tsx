import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";

/**
 * One gap at a time, after distillation.
 *
 * The questions are a closed set. The card never invents a prompt.
 */
export default function ClarifyCard(props: { personaId: number; name: string }) {
  const { t } = useLocale();
  const [later, setLater] = useState(false);
  const [text, setText] = useState("");
  /**
   * How many answers were actually submitted in this visit (B1.6).
   *
   * 验收 4 says a skipped question is not written. So when everything
   * was skipped nothing was recorded, and the finished card — "这些已经
   * 记进 {{name}} 的规则里" — would be false. It is shown only after at
   * least one answer. (The manual's 做法 2 says skips are recorded too;
   * the two contradict each other — see the deviation in the report.)
   */
  const [answered, setAnswered] = useState(0);
  const [skipped, setSkipped] = useState<string[]>([]);
  const query = trpc.persona.clarifications.useQuery(
    { id: props.personaId },
    { enabled: props.personaId > 0 },
  );
  const answer = trpc.persona.answerClarification.useMutation({
    onSuccess: () => {
      setText("");
      void query.refetch();
    },
  });

  if (later) return null;
  if (query.isError) return null;

  const questions = (query.data?.questions ?? []).filter((row) => !skipped.includes(row.id));
  if (query.isLoading) return null;
  if (questions.length === 0) {
    if (answered === 0) return null;
    return (
      <div className="mb-6 rounded-md border border-border bg-muted/30 p-4 sm:p-5">
        <p className="text-sm text-foreground/85 leading-relaxed">
          {t("clarify.done", { name: props.name })}
        </p>
      </div>
    );
  }

  const current = questions[0]!;
  const submit = (value: string) => {
    setAnswered((count) => count + 1);
    answer.mutate({
      id: props.personaId,
      questionId: current.id,
      answer: value,
      skip: false,
    });
  };

  return (
    <div className="mb-6 rounded-md border border-border bg-muted/30 p-4 sm:p-5 space-y-3">
      <p className="text-xs text-muted-foreground">
        {t("clarify.intro", { count: questions.length })}
      </p>
      <p className="text-sm text-foreground leading-relaxed">{current.prompt}</p>
      {current.input === "choice" && current.choices && (
        <div className="flex flex-wrap gap-2">
          {current.choices.map((choice) => (
            <button
              key={choice.value}
              type="button"
              className="text-sm underline underline-offset-2"
              disabled={answer.isPending}
              onClick={() => submit(choice.value)}
            >
              {choice.label}
            </button>
          ))}
        </div>
      )}
      {(current.input === "text" ||
        current.input === "text-or-same" ||
        current.input === "skipable-text") && (
        <div className="flex flex-col gap-2">
          <input
            type="text"
            value={text}
            maxLength={40}
            onChange={(event) => setText(event.target.value)}
            className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm"
          />
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className="text-sm underline underline-offset-2"
              disabled={answer.isPending || !text.trim()}
              onClick={() => submit(text)}
            >
              {t("clarify.submit")}
            </button>
            {current.input === "text-or-same" && (
              <button
                type="button"
                className="text-sm underline underline-offset-2"
                disabled={answer.isPending}
                onClick={() => submit("same")}
              >
                {t("clarify.same")}
              </button>
            )}
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className="text-xs underline underline-offset-2 text-muted-foreground"
          disabled={answer.isPending}
          onClick={() => {
            // 验收 4: a skip writes nothing, so it does not count as an
            // answer and must not produce the "记进规则" claim.
            setText("");
            setSkipped((ids) => [...ids, current.id]);
          }}
        >
          {t("clarify.skip")}
        </button>
        <button
          type="button"
          className="text-xs underline underline-offset-2 text-muted-foreground"
          onClick={() => setLater(true)}
        >
          {t("clarify.later")}
        </button>
      </div>
    </div>
  );
}
