import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface OralAccount {
  id: number;
  tellerName: string;
  body: string;
  submitted: boolean;
  mine: boolean;
}

interface OralConflict {
  key: string;
  items: Array<{ id: number; title: string; description: string | null }>;
}

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

/**
 * What people remember about the person (C7.4).
 *
 * The owner writes what they remember; family members who use a shared
 * persona can write too, and are told before submitting that the owner
 * will read it. Nothing here is generated: the extraction only happens
 * when the owner presses the button, and only statements whose words
 * are literally in an account become memories.
 */
export default function OralAccounts({
  personaId,
  name,
}: {
  personaId: number;
  name: string;
}) {
  const { t } = useLocale();
  const list = trpc.oral.list.useQuery({ personaId });
  const [body, setBody] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const save = trpc.oral.save.useMutation({
    onSuccess: () => {
      setBody("");
      setEditingId(null);
      list.refetch();
    },
    onError: (error: { message: string }) => toast.error(error.message),
  });
  const extract = trpc.oral.extract.useMutation({
    onSuccess: (result: {
      created: number;
      dropped: number;
      repeated: number;
      readable: boolean;
    }) => {
      if (!result.readable) {
        toast.error(t("oral.extractUnreadable"));
        return;
      }
      if (result.created > 0) {
        toast.success(
          t(result.repeated > 0 ? "oral.extractRepeated" : "oral.extracted", {
            n: result.created,
            m: result.repeated,
          }),
        );
      } else {
        toast.success(t("oral.extractNothing"));
      }
      if (result.dropped > 0) toast.message(t("oral.extractDropped", { n: result.dropped }));
      list.refetch();
    },
    onError: (error: { message: string }) => toast.error(error.message),
  });
  const transcribe = trpc.oral.transcribe.useMutation({
    onSuccess: (result: { text: string }) => {
      if (!result.text) {
        toast.error(t("chat.voiceNotUnderstood"));
        return;
      }
      // The words go into the form, not into the database: the teller
      // reads them and edits them before anything is kept.
      setBody((current) => (current ? `${current}\n${result.text}` : result.text));
    },
    onError: (error: { message: string }) => toast.error(error.message),
  });
  const adjudicate = trpc.memory.adjudicate.useMutation({
    onSuccess: () => list.refetch(),
    onError: (error: { message: string }) => toast.error(error.message),
  });

  const canRecord =
    typeof window !== "undefined" &&
    typeof window.MediaRecorder !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia);

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
          transcribe.mutate({ personaId, audioContent, fileName: "oral.webm" });
        });
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      toast.error(t("oral.micDenied"));
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  }

  if (list.isLoading) {
    return <p className="text-xs text-muted-foreground">{t("common.loading")}</p>;
  }
  if (list.isError) {
    return (
      <p className="text-xs text-muted-foreground">
        {t("oral.loadFailed")}{" "}
        <button
          type="button"
          onClick={() => list.refetch()}
          className="underline underline-offset-2"
        >
          {t("common.retry")}
        </button>
      </p>
    );
  }

  const data = list.data;
  const accounts: OralAccount[] = data?.accounts ?? [];
  const conflicts: OralConflict[] = data?.conflicts ?? [];
  const isOwner = data?.isOwner ?? false;
  const mine = accounts.filter((account) => account.mine);
  const family = accounts.filter((account) => !account.mine && account.submitted);

  return (
    <div className="space-y-4">
      <h2 className="section-title">{t("oral.title", { name })}</h2>
      <p className="text-muted-foreground text-sm leading-relaxed">
        {isOwner
          ? t("oral.ownerNote", { name })
          : t("oral.familyNote", { name, owner: data?.ownerName || "" })}
      </p>

      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder={t("oral.hint", { name })}
        rows={4}
        className="w-full rounded-lg border border-border bg-background p-3 text-sm leading-relaxed"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={body.trim().length === 0 || save.isPending}
          onClick={() => save.mutate({ personaId, id: editingId ?? undefined, body, submit: false })}
        >
          {t("oral.saveDraft")}
        </Button>
        <Button
          size="sm"
          disabled={body.trim().length === 0 || save.isPending}
          onClick={() => save.mutate({ personaId, id: editingId ?? undefined, body, submit: true })}
        >
          {t("oral.submit")}
        </Button>
        {canRecord && (
          <Button
            size="sm"
            variant="outline"
            onClick={recording ? stopRecording : () => void startRecording()}
            disabled={transcribe.isPending}
          >
            {recording ? t("oral.stopRecording") : t("oral.record")}
          </Button>
        )}
        {recording && (
          <span className="text-xs text-muted-foreground">{t("oral.recording")}</span>
        )}
      </div>

      {accounts.length === 0 && (
        <p className="text-xs text-muted-foreground">{t("oral.empty", { name })}</p>
      )}

      {[
        { title: t("oral.mine"), rows: mine },
        { title: t("oral.family"), rows: family },
      ].map((group) => {
        if (group.rows.length === 0) return null;
        return (
          <section key={group.title} className="space-y-2">
            <h3 className="text-xs font-medium text-muted-foreground">{group.title}</h3>
            {group.rows.map((account) => (
              <article
                key={account.id}
                className="rounded-lg border border-border/70 p-3 text-sm leading-relaxed whitespace-pre-wrap"
              >
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{account.tellerName}</span>
                  <span className="rounded-sm bg-muted px-1.5 py-0.5">
                    {account.submitted ? t("oral.submitted") : t("oral.draft")}
                  </span>
                </div>
                <p className="mt-1 text-foreground">{account.body}</p>
                {account.mine && (
                  <button
                    type="button"
                    className="mt-1 text-[11px] underline underline-offset-2"
                    onClick={() => {
                      setBody(account.body);
                      setEditingId(account.id);
                    }}
                  >
                    {t("oral.edit")}
                  </button>
                )}
              </article>
            ))}
          </section>
        );
      })}

      {isOwner && accounts.some((account) => account.submitted) && (
        <div className="space-y-2">
          <Button
            size="sm"
            disabled={extract.isPending}
            onClick={() => extract.mutate({ personaId })}
          >
            {t("oral.extract")}
          </Button>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {t("oral.extractHint", { name })}
          </p>
        </div>
      )}

      {isOwner && conflicts.length > 0 && (
        <section className="space-y-3">
          {conflicts.map((conflict) => (
            <div key={conflict.key} className="space-y-2">
              <h3 className="text-xs font-medium text-foreground">
                {t("oral.conflictTitle", { topic: conflict.items[0]?.title ?? conflict.key })}
              </h3>
              {conflict.items.map((item) => (
                <div key={item.id} className="rounded-lg border border-border/70 p-3">
                  <p className="text-sm text-foreground">{item.title}</p>
                  {item.description && (
                    <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                  )}
                  <button
                    type="button"
                    className="mt-1 text-[11px] underline underline-offset-2"
                    disabled={adjudicate.isPending}
                    onClick={() => {
                      for (const other of conflict.items) {
                        if (other.id === item.id) continue;
                        adjudicate.mutate({ personaId, winnerId: item.id, loserId: other.id });
                      }
                    }}
                  >
                    {t("oral.keepThis")}
                  </button>
                </div>
              ))}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
