import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { InterviewAspect, InterviewTurn } from "@shared/interview";

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}

interface CurrentQuestion {
  aspect: InterviewAspect;
  question: string;
  round: number;
}

/**
 * The interview for a person with no records (C1.8).
 *
 * The browser keeps the transcript and sends it back with every turn; the
 * server decides which of the ten aspects to ask about next and when the
 * interview is over. That keeps the rule on the server and the session
 * out of the database — a reload loses nothing that was already sent.
 *
 * The person may type or speak. A recording is transcribed on the server
 * and the words land in the box: they are sent only after the person has
 * seen them, which is the difference between a transcript and a guess at
 * what somebody said.
 */
export default function InterviewView({
  personaId,
  personaName,
  initialName,
}: {
  /** An existing persona described by interview; absent for a new one. */
  personaId?: number;
  /** The name of that persona, when it already exists. */
  personaName?: string;
  /** The name typed before the page was opened (the creation flow). */
  initialName?: string;
}) {
  const { t } = useLocale();
  const [, navigate] = useLocation();
  const [name, setName] = useState(initialName ?? personaName ?? "");
  const [phase, setPhase] = useState<"setup" | "chat" | "finishing">(
    personaId ? "chat" : "setup",
  );
  const [transcript, setTranscript] = useState<InterviewTurn[]>([]);
  const [current, setCurrent] = useState<CurrentQuestion | null>(null);
  const [draft, setDraft] = useState("");
  const [recording, setRecording] = useState(false);
  const [starting, setStarting] = useState(Boolean(personaId));
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  /** Whether the first question has been asked (and must not be re-asked). */
  const asked = useRef(false);
  /**
   * The transcript as of the latest render.
   *
   * A mutation's success handler runs after the render that started it,
   * so it reads this rather than a captured copy of the state.
   */
  const transcriptRef = useRef<InterviewTurn[]>([]);
  transcriptRef.current = transcript;

  const finish = trpc.interview.finish.useMutation({
    onSuccess: (result) => {
      toast.success(t("interview.finished"));
      navigate(`/persona/${result.personaId}/profile`);
    },
    onError: (error: { message: string }) => {
      setPhase("chat");
      toast.error(t("interview.createFailed", { message: error.message }));
    },
  });

  const next = trpc.interview.next.useMutation({
    onSuccess: (result) => {
      setStarting(false);
      if (result.done) {
        finishNow(transcriptRef.current);
        return;
      }
      setCurrent({
        aspect: result.aspect as InterviewAspect,
        question: result.question,
        round: result.round,
      });
    },
    onError: () => {
      setStarting(false);
      toast.error(t("interview.failed"));
    },
  });

  const transcribe = trpc.interview.transcribe.useMutation({
    onSuccess: (result: { text: string }) => {
      if (!result.text) {
        toast.error(t("interview.voiceNotUnderstood"));
        return;
      }
      // The words go into the box, not straight into the transcript: the
      // person reads them before they count as something they said.
      setDraft((draftSoFar) => (draftSoFar ? `${draftSoFar}\n${result.text}` : result.text));
    },
    onError: (error: { message: string }) => toast.error(error.message),
  });

  function finishNow(turns: InterviewTurn[]) {
    if (finish.isPending) return;
    if (turns.length === 0) {
      toast.error(t("interview.empty"));
      return;
    }
    setPhase("finishing");
    finish.mutate({
      transcript: turns,
      ...(personaId ? { personaId } : { name: name.trim() }),
    });
  }

  /**
   * The turns to write the persona from.
   *
   * 「就这些」 may be pressed with an answer typed but not sent yet; that
   * answer is part of what the person said, so it goes in rather than
   * being dropped.
   */
  function turnsToFinish(): InterviewTurn[] {
    const answer = draft.trim();
    if (current && answer) {
      return [
        ...transcript,
        { aspect: current.aspect, question: current.question, answer },
      ];
    }
    return transcript;
  }

  function ask(transcriptSoFar: InterviewTurn[]) {
    // The answer handler may run before React has re-rendered with the
    // new transcript, so the ref is updated here rather than only in the
    // render below.
    transcriptRef.current = transcriptSoFar;
    setStarting(true);
    next.mutate({ transcript: transcriptSoFar });
  }

  function begin() {
    if (starting || next.isPending) return;
    if (!personaId && !name.trim()) {
      toast.error(t("interview.nameHint"));
      return;
    }
    setPhase("chat");
    if (asked.current) return;
    asked.current = true;
    ask([]);
  }

  // An existing persona's interview starts as soon as the page opens.
  useEffect(() => {
    if (!personaId || asked.current) return;
    asked.current = true;
    ask([]);
    // `ask` and `next` are stable for the life of the page; the guard above
    // is what keeps this from asking twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personaId]);

  function send() {
    const answer = draft.trim();
    if (!current) return;
    if (!answer) {
      toast.error(t("interview.empty"));
      return;
    }
    const answered: InterviewTurn[] = [
      ...transcript,
      { aspect: current.aspect, question: current.question, answer },
    ];
    setTranscript(answered);
    setCurrent(null);
    setDraft("");
    ask(answered);
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        void blobToBase64(blob).then((audioContent) => {
          transcribe.mutate({ audioContent, fileName: "interview.webm" });
        });
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      toast.error(t("interview.micDenied"));
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  }

  const canRecord =
    typeof window !== "undefined" &&
    typeof window.MediaRecorder !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia);
  const shownName = personaName || name.trim() || "TA";
  const thinking = (starting || next.isPending) && !current;

  if (phase === "setup" && !personaId) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-lg space-y-4">
          <div>
            <h1 className="text-xl font-semibold text-foreground">
              {t("interview.title", { name: shownName })}
            </h1>
            <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
              {t("interview.intro")}
            </p>
          </div>
          <div className="space-y-2">
            <label htmlFor="interview-name" className="text-xs font-medium text-foreground/80">
              {t("interview.nameLabel")}
            </label>
            <input
              id="interview-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("interview.namePlaceholder")}
              className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm"
            />
            <p className="text-xs text-muted-foreground">{t("interview.nameHint")}</p>
          </div>
          <Button className="w-full" onClick={begin} disabled={starting}>
            {t("interview.start")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-lg space-y-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">
            {t("interview.title", { name: shownName })}
          </h1>
          <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
            {t("interview.intro")}
          </p>
        </div>

        <div className="space-y-3" aria-live="polite">
          {transcript.map((turn, index) => (
            <div key={index} className="space-y-2">
              <p className="text-sm text-muted-foreground leading-relaxed">{turn.question}</p>
              <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                {turn.answer}
              </p>
            </div>
          ))}
          {current ? (
            <p className="text-sm text-foreground leading-relaxed" data-testid="interview-question">
              {current.question}
            </p>
          ) : thinking && phase !== "finishing" ? (
            <p className="text-sm text-muted-foreground">{t("interview.thinking")}</p>
          ) : null}
        </div>

        {phase === "finishing" ? (
          <p className="text-sm text-muted-foreground">{t("interview.finishing")}</p>
        ) : (
          <div className="space-y-2">
            <label htmlFor="interview-answer" className="sr-only">
              {t("interview.placeholder")}
            </label>
            <textarea
              id="interview-answer"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  send();
                }
              }}
              placeholder={t("interview.placeholder")}
              rows={3}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              disabled={!current}
            />
            {canRecord ? (
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="rounded-md"
                  onClick={recording ? stopRecording : () => void startRecording()}
                  disabled={transcribe.isPending}
                >
                  {recording ? t("interview.stopRecording") : t("interview.record")}
                </Button>
                {recording ? (
                  <span className="text-xs text-muted-foreground">{t("interview.recording")}</span>
                ) : (
                  <span className="text-xs text-muted-subtle">{t("interview.transcriptNote")}</span>
                )}
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                onClick={send}
                disabled={!current || next.isPending || finish.isPending}
              >
                {t("interview.send")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="text-muted-foreground"
                onClick={() => finishNow(turnsToFinish())}
                disabled={finish.isPending}
              >
                {t("interview.done")}
              </Button>
            </div>
            <p className="text-xs text-muted-subtle leading-relaxed">{t("interview.finishHint")}</p>
          </div>
        )}
      </div>
    </div>
  );
}
