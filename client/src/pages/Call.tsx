import { useEffect, useRef, useState } from "react";
import { useLocation, useParams } from "wouter";
import { ArrowLeft, Mic, MicOff, PhoneOff } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLocale } from "@/contexts/LocaleContext";
import { copy } from "@shared/copy";
import { normalizePersonaSettings } from "@shared/persona-settings";
import { Button } from "@/components/ui/button";
import PageLoader from "@/components/PageLoader";
import NotFound from "@/pages/NotFound";

interface Slot {
  weekday: number;
  hour: number;
}

interface Line {
  who: "me" | "them";
  text: string;
}

/** The energy above which the user is speaking, not room noise. */
export const BARGE_IN_RMS = 0.035;

/** Whether the user speaking should stop the answer being played. */
export function shouldBargeIn(rms: number, playing: boolean): boolean {
  return playing && rms > BARGE_IN_RMS;
}

/**
 * Phone mode (B7.14).
 *
 * A spoken conversation over the same WebSocket protocol the server
 * describes: what the user says goes up as audio, comes back as text,
 * and every sentence of the answer is played as audio. The fixed line
 * under the avatar says the voice is synthesised — on every call, not
 * only the first.
 */
export default function Call() {
  const params = useParams<{ id: string }>();
  const personaId = Number.parseInt(params.id ?? "", 10);
  const [, navigate] = useLocation();
  const { isAuthenticated, loading: authLoading, user } = useAuth({ redirectOnUnauthenticated: true });
  const { t, locale } = useLocale();
  const { data: persona, isLoading, isError } = trpc.persona.get.useQuery(
    { id: personaId },
    { enabled: isAuthenticated && Number.isInteger(personaId) && personaId > 0 },
  );

  const [status, setStatus] = useState<"connecting" | "ready" | "declined" | "ended" | "error">("connecting");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [muted, setMuted] = useState(false);
  const [micDenied, setMicDenied] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const socketRef = useRef<WebSocket | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioQueue = useRef<HTMLAudioElement[]>([]);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const playingRef = useRef(false);
  const mutedRef = useRef(false);
  /**
   * Whether audio frames may still be played.
   *
   * Sending `interrupt` means the user stopped this answer. The server
   * abandons the sentence it was already synthesising, but a frame that
   * was already on the wire can still arrive after the acknowledgement;
   * playing it would talk over the person. Frames are dropped until the
   * next turn begins (`transcript`), which is where the server starts
   * answering what the user said next.
   */
  const suppressAudioRef = useRef(false);

  const settings = normalizePersonaSettings(persona?.settings);
  const enabled = settings.layers.callMode;
  const personaName = persona?.name || "";

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  useEffect(() => {
    if (!persona || !enabled) return;
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(
      `${protocol}://${window.location.host}/api/call?personaId=${personaId}`,
    );
    socket.binaryType = "arraybuffer";
   socketRef.current = socket;
    wsRef.current = socket;
    socket.onopen = () => {
      setStatus("connecting");
      suppressAudioRef.current = false;
      socket.send(JSON.stringify({ type: "start" }));
    };
    socket.onmessage = (event) => {
      if (typeof event.data !== "string") {
        /**
         * A frame that arrives after the user asked to interrupt belongs
         * to the answer they stopped. The server no longer sends those
         * (B7.14); this is the client's half of the promise, for frames
         * already in flight.
         */
        if (suppressAudioRef.current) return;
        const bytes = new Uint8Array(event.data as ArrayBuffer);
        playAudio(bytes);
        return;
      }
      let message: Record<string, any>;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.type === "ready") {
        setStatus("ready");
      } else if (message.type === "declined") {
        setStatus("declined");
        setSlots(Array.isArray(message.slots) ? message.slots : []);
      } else if (message.type === "transcript") {
        // A new turn: what the user just said is being answered, so the
        // old answer's frames can no longer arrive and audio is wanted
        // again.
        suppressAudioRef.current = false;
        setLines((current) => [...current, { who: "me", text: String(message.text ?? "") }]);
      } else if (message.type === "reply") {
        setLines((current) => [...current, { who: "them", text: String(message.text ?? "") }]);
      } else if (message.type === "crisis") {
        setLines((current) => [...current, { who: "them", text: t("call.crisis") }]);
      } else if (message.type === "error") {
        setError(String(message.message ?? ""));
      }
    };
    socket.onerror = () => {
      setStatus("error");
      setError(t("call.connectionFailed"));
    };
    socket.onclose = () => {
      setStatus((current) => (current === "declined" ? current : "ended"));
    };
    return () => {
      socket.close();
      socketRef.current = null;
      wsRef.current = null;
      stopAudio();
    };
  }, [persona, enabled, personaId, t]);

  useEffect(() => {
    if (status !== "ready") return;
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [status]);

  useEffect(() => {
    if (!enabled || status !== "ready") return;
    let cancelled = false;
    let audioContext: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let recorder: MediaRecorder | null = null;
    let chunks: Blob[] = [];
    let silenceSince: number | null = null;
    let speaking = false;
    let speakingSince: number | null = null;
    let bargedIn = false;

    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        audioContext = new AudioContext();
        const source = audioContext.createMediaStreamSource(stream);
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        const buffer = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          if (cancelled || !analyser) return;
          analyser.getByteTimeDomainData(buffer);
          let sum = 0;
          for (const value of buffer) {
            const delta = (value - 128) / 128;
            sum += delta * delta;
          }
          const rms = Math.sqrt(sum / buffer.length);
          const now = Date.now();
          /**
           * Barge-in (B7.14).
           *
           * While the answer is playing, the user speaking means they
           * want to say something now. Stop the audio, drop the queued
           * sentences and tell the server not to send the rest. This is
           * what makes a call a conversation instead of a broadcast.
           */
          if (!bargedIn && shouldBargeIn(rms, playingRef.current || audioQueue.current.length > 0)) {
            bargedIn = true;
            // Drop every frame still on its way from the answer being
            // stopped, including the one the server may have been
            // synthesising when the interrupt arrives.
            suppressAudioRef.current = true;
            stopAudio();
            if (wsRef.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({ type: "interrupt" }));
            }
          }
          if (rms > BARGE_IN_RMS) {
            if (!speaking) {
              speaking = true;
              speakingSince = now;
            }
            silenceSince = null;
          } else if (speaking) {
            silenceSince ??= now;
            if (now - (silenceSince ?? now) > 700 && speakingSince) {
              speaking = false;
              speakingSince = null;
              silenceSince = null;
              bargedIn = false;
            }
          }
          // Recording starts on speech; it stops after 700 ms of silence.
          if (speaking && !recorder && !mutedRef.current) {
            chunks = [];
            recorder = new MediaRecorder(stream);
            recorder.ondataavailable = (event) => {
              if (event.data.size > 0) chunks.push(event.data);
            };
            recorder.onstop = () => {
              const blob = new Blob(chunks, { type: "audio/webm" });
              chunks = [];
              recorder = null;
              if (blob.size > 0) {
                void blob.arrayBuffer().then((data) => {
                  if (!cancelled && wsRef.current?.readyState === WebSocket.OPEN) {
                    wsRef.current.send(data);
                  }
                });
              }
            };
            recorder.start();
          }
          if (!speaking && recorder && recorder.state === "recording") recorder.stop();
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      } catch {
        if (!cancelled) setMicDenied(true);
      }
    })();

    return () => {
      cancelled = true;
      recorder?.state === "recording" && recorder.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      void audioContext?.close();
    };
  }, [enabled, status]);

  function playAudio(bytes: Uint8Array) {
    const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: "audio/mpeg" });
    const audio = new Audio(URL.createObjectURL(blob));
    audioQueue.current.push(audio);
    void playNext();
  }

  async function playNext() {
    if (playingRef.current) return;
    const next = audioQueue.current.shift();
    if (!next) return;
    playingRef.current = true;
    currentAudioRef.current = next;
    next.onended = () => {
      if (currentAudioRef.current === next) currentAudioRef.current = null;
      playingRef.current = false;
      void playNext();
    };
    try {
      await next.play();
    } catch {
      /**
       * The browser refused the clip (autoplay policy, or the audio
       * element was torn down). Dropping `playingRef` without moving on
       * left the rest of the answer queued for ever; the next clip is a
       * better attempt than a silent stop.
       */
      if (currentAudioRef.current === next) currentAudioRef.current = null;
      playingRef.current = false;
      void playNext();
    }
  }

  function stopAudio() {
    // The clip that is already playing is paused too; pausing only the
    // queue left the last sentence talking over the user.
    currentAudioRef.current?.pause();
    currentAudioRef.current = null;
    for (const audio of audioQueue.current) audio.pause();
    audioQueue.current = [];
    playingRef.current = false;
  }

  function hangup() {
    wsRef.current?.send(JSON.stringify({ type: "hangup" }));
    wsRef.current?.close();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    stopAudio();
    navigate(`/chat/${personaId}`);
  }

  if (!Number.isInteger(personaId) || personaId <= 0) return <NotFound />;
  if (isLoading || authLoading) return <PageLoader />;
  if (isError || !persona) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Button variant="outline" onClick={() => navigate(`/chat/${personaId}`)}>
          {t("common.back")}
        </Button>
      </div>
    );
  }
  if (!enabled) {
    return (
      <div className="min-h-screen bg-background p-6">
        <p className="text-sm text-muted-foreground">{t("call.off")}</p>
        <Button className="mt-4 rounded-md" variant="outline" onClick={() => navigate(`/chat/${personaId}`)}>
          {t("common.back")}
        </Button>
      </div>
    );
  }

  const slotText = slots
    .map((slot) =>
      t("call.slot", {
        weekday: copy(locale, `labels.routine.weekday.${slot.weekday}` as "labels.routine.weekday.0"),
        hour: slot.hour,
      }),
    )
    .join(t("call.slotSeparator"));

  return (
    <div className="min-h-dvh bg-background flex flex-col">
      <header className="app-header">
        <div className="container app-nav">
          <button
            type="button"
            className="app-nav-back"
            aria-label={t("common.back")}
            onClick={() => navigate(`/chat/${personaId}`)}
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <p className="app-nav-title truncate">{personaName}</p>
          <span className="text-xs text-muted-subtle tabular-nums">
            {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
          </span>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center gap-4 p-6">
        <div className="w-24 h-24 rounded-full bg-muted flex items-center justify-center text-3xl">
          {personaName.charAt(0)}
        </div>
        <p className="text-xs text-muted-subtle">
          {t("call.synthesised", { name: personaName })}
        </p>
        {status === "connecting" && (
          <p className="text-sm text-muted-foreground">{t("call.connecting")}</p>
        )}
        {status === "ready" && (
          <p className="text-sm text-muted-foreground">{t("call.ready")}</p>
        )}
        {status === "declined" && (
          <div className="text-center space-y-2">
            <p className="text-sm text-foreground">
              {t("call.declined", { name: personaName, slots: slotText })}
            </p>
            <Button
              size="sm"
              className="rounded-md"
              onClick={() => {
                wsRef.current?.send(JSON.stringify({ type: "start", force: true }));
                setStatus("connecting");
              }}
            >
              {t("call.force")}
            </Button>
          </div>
        )}
        {status === "ended" && <p className="text-sm text-muted-foreground">{t("call.ended")}</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {micDenied && (
          <div className="max-w-md text-center space-y-1">
            <p className="text-sm text-foreground">{t("call.micDenied")}</p>
            <p className="text-xs text-muted-foreground">{t("call.micDeniedHint")}</p>
          </div>
        )}

        <div className="w-full max-w-xl max-h-[40vh] overflow-y-auto space-y-1.5">
          {lines.map((line, index) => (
            <div
              key={index}
              className={`text-sm ${line.who === "me" ? "text-right text-muted-foreground" : "text-foreground"}`}
            >
              {line.text}
            </div>
          ))}
        </div>
      </main>

      <div className="flex items-center justify-center gap-4 pb-8">
        <Button
          size="icon"
          variant="outline"
          className="rounded-full w-12 h-12"
          aria-label={muted ? t("call.unmute") : t("call.mute")}
          onClick={() => setMuted((value) => !value)}
        >
          {muted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
        </Button>
        <Button
          size="icon"
          variant="destructive"
          className="rounded-full w-14 h-14"
          aria-label={t("call.hangup")}
          onClick={hangup}
        >
          <PhoneOff className="w-6 h-6" />
        </Button>
      </div>
    </div>
  );
}
