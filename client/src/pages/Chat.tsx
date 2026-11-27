import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from "react";
import NotFound from "@/pages/NotFound";
import { useLocation, useParams } from "wouter";
import { motion } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  ArrowLeft, Send, ChevronDown, Trash2, MoreVertical,
  Plus, Image, Mic, X, Clock, BarChart3, Search, BookOpen, Theater,
  Download, Check, HeartCrack, UserRound, Moon, CornerUpLeft, CalendarClock, Star, Quote,
} from "lucide-react";
import { PersonaAvatar } from "@/components/PersonaAvatar";
import { MessageBubble, emotionOf, type Message } from "@/components/MessageBubble";
import { Button } from "@/components/ui/button";
import CrisisCard from "@/components/CrisisCard";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useDialogFocus } from "@/lib/use-dialog-focus";
import { toast } from "sonner";
import GraduationModal from "@/components/GraduationModal";
import { streamChat, isStreamingUnsupported } from "@/lib/chat-stream";
import { normalizePeriods } from "@shared/periods";
import { careBannerText } from "@/lib/care-note";
import { resolveStarterQuestions } from "@/lib/scene-starters";
import { useLocale } from "@/contexts/LocaleContext";
import { formatZonedClock, zonedHour, daysSinceContact } from "@shared/timezone";
import { formatDayKey, formatInstantInZone, formatTimeInZone } from "@/lib/dates";
import DigitalPersonaBadge from "@/components/DigitalPersonaBadge";
import TimeBar from "@/components/v6/TimeBar";
import { normalizePersonaSettings } from "@shared/persona-settings";
import { mayChatNow } from "@shared/persona-state";
import { provenanceFromMetadata } from "@shared/provenance";
import { EMOTIONS, EMOTION_KEYS, emotionColor, type EmotionKey } from "@/lib/emotions";
import { useConfirm } from "@/components/ConfirmDialog";
import MemoryReview from "@/components/v6/MemoryReview";
import ChoiceBubble from "@/components/v6/ChoiceBubble";
import PendingReply from "@/components/v6/PendingReply";
import PersonaLockGate from "@/components/v6/PersonaLockGate";
import OutboundEntry from "@/components/v6/OutboundEntry";
import VoicesEntry from "@/components/v6/VoicesEntry";
import OutboundDrawer from "@/components/v6/OutboundDrawer";
import WaitGauge from "@/components/v6/WaitGauge";
import MeetDayNote from "@/components/v6/MeetDayNote";
import MeetCountdown from "@/components/v6/MeetCountdown";
import TheirSide from "@/components/v6/TheirSide";
import ScheduledSend from "@/components/v6/ScheduledSend";
import ClosedComposer from "@/components/v6/ClosedComposer";
import ReadMarker from "@/components/v6/ReadMarker";
import { useUndoToast } from "@/components/v6/UndoToast";
import BudgetNotice from "@/components/v6/BudgetNotice";
import PinnedBand from "@/components/v6/PinnedBand";
import MarksPanel from "@/components/v6/MarksPanel";
import { useDraft } from "@/components/v6/useDraft";
import { clearQuoteDraft, readQuoteDraft, type QuoteLine } from "@/components/v6/quote-selection";
import AfterChat from "@/components/v6/AfterChat";
import { useTypingReveal, waitMs } from "@/components/v6/useTypingReveal";
import ScenePanel from "@/components/v6/ScenePanel";
import SceneRangeBanner from "@/components/v6/SceneRangeBanner";

/** A message the reply carried besides its words (B7.1). */
type ExtraMessage = {
  messageId: number;
  kind: string;
  content: string;
  mediaUrl?: string | null;
  photoAt?: string | null;
};

function extraBubbles(extra: ExtraMessage[] | undefined, emotionalState: string): Message[] {
  return (extra ?? []).map((row) => ({
    id: row.messageId,
    role: "assistant" as const,
    content: row.kind === "sticker" ? `[sticker:${row.content}]` : row.content,
    kind: row.kind,
    /** A photo is drawn by the same picture bubble as an upload (B7.9). */
    messageType: row.kind === "photo" ? ("image" as const) : undefined,
    mediaUrl: row.mediaUrl ?? null,
    photoAt: row.photoAt ?? null,
    emotionalState,
    createdAt: new Date(),
    isStreaming: false,
  }));
}

/**
 * The largest picture the chat will send.
 *
 * The server's own limit — twenty megabytes, decoded. The picture is
 * checked here before it is read into memory, so a file of any size
 * cannot take the tab with it.
 */
const MAX_IMAGE_UPLOAD_BYTES = 20 * 1024 * 1024;


// ─── MAIN CHAT ────────────────────────────────────────────────────────────────


/**
 * Whether a failed send left the user's message in the transcript.
 *
 * The server says so: the user's own message is stored before the
 * model is called, so it is in the transcript — and it stays there,
 * because the channels depend on it (a person who wrote a message on
 * WeChat cannot have it put back in a composer).
 *
 * So when the turn fails the bubble stays and the text does not go
 * back into the composer. Taking the bubble away *and* saying "the
 * server did not store the message" was a claim that was simply false
 * — and twenty seconds later the poll brought the message back on its
 * own, or the user had retyped it and the transcript had it twice.
 *
 * Exported so the test can say what the screen does with it.
 */
export function failedSendKeepsTheMessage(result: unknown): boolean {
  return Boolean((result as { failed?: boolean } | null | undefined)?.failed);
}

export type SelectedPeriod = { from: string; to: string } | null;

export function ChatPeriodHint({
  period,
  name,
}: {
  period: SelectedPeriod;
  name: string;
}) {
  const { t } = useLocale();
  if (!period) return null;
  return (
    <p className="text-[0.625rem] text-muted-subtle leading-snug">
      {t("chat.periodBoundary", { from: period.from, to: period.to, name })}
    </p>
  );
}

function routineFromMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as { routine?: unknown }).routine;
  return typeof value === "string" && value.trim() ? value : null;
}

function claimsFromMetadata(
  metadata: unknown,
): Array<{ text: string; supported: boolean; date?: string | null }> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return [];
  const raw = (metadata as { claims?: unknown }).claims;
  if (!Array.isArray(raw)) return [];
  const out: Array<{ text: string; supported: boolean; date?: string | null }> = [];
  for (const row of raw) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const text = (row as { text?: unknown }).text;
    if (typeof text !== "string" || !text.trim()) continue;
    const supported = Boolean((row as { supported?: unknown }).supported);
    const at = (row as { source?: { at?: unknown } }).source?.at;
    const date = typeof at === "string" && at.trim() ? at : null;
    out.push({ text, supported, date });
  }
  return out;
}

function originFromHistory(m: {
  origin?: unknown;
  content?: unknown;
  metadata?: unknown;
}): Message["origin"] {
  if (
    m.origin === "letter"
    || m.origin === "proactive"
    || m.origin === "system-notice"
    || m.origin === "recall"
    || m.origin === "pat"
    || m.origin === "followup"
  ) {
    return m.origin;
  }
  const metadata = m.metadata;
  const kind = metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as { kind?: unknown }).kind
    : null;
  if (kind === "recall" || kind === "pat") return kind;
  if (m.content === "[recall]") return "recall";
  if (m.content === "[pat]") return "pat";
  return typeof m.origin === "string" ? (m.origin as Message["origin"]) : null;
}

function photoAtFromMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as { photoAt?: unknown }).photoAt;
  return typeof value === "string" ? value : null;
}

function pendingChoiceFromMetadata(metadata: unknown): { options: [string, string] } | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const raw = (metadata as { pendingChoice?: unknown }).pendingChoice;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const options = Array.isArray((raw as { options?: unknown }).options)
    ? (raw as { options: unknown[] }).options.filter((item): item is string => typeof item === "string")
    : [];
  if (options.length < 2) return null;
  return { options: [options[0], options[1]] };
}

export default function Chat() {
  const params = useParams<{ id: string }>();
  /**
   * The persona's id, and whether it is one at all.
   *
   * `parseInt("abc")` is NaN, and `NaN > 0` is false — so every query
   * was disabled and the page had nothing to show and nothing to say.
   */
  const personaId = Number.parseInt(params.id ?? "", 10);
  const hasPersonaId = Number.isInteger(personaId) && personaId > 0;
  const [, navigate] = useLocation();
  const { isAuthenticated, user } = useAuth({ redirectOnUnauthenticated: true });
  const { t, locale } = useLocale();
  /**
   * The app's own confirmation.
   *
   * It was the browser's own dialog — whose buttons say "OK" and
   * "Cancel" in the *browser's* language, not the language the person
   * is reading the app in.
   */
  const confirm = useConfirm();
  const { revealDelay, revealBurst } = useTypingReveal();

  const [messages, setMessages] = useState<Message[]>([]);

  /**
   * The blob URLs made for the pictures and the voice messages the user
   * has just sent.
   *
   * They were never released. A blob URL holds its blob in memory for
   * as long as it exists, and it exists until it is revoked — so a
   * long chat with a lot of pictures leaked every one of them, and the
   * tab got heavier and heavier for as long as it was open.
   *
   * A URL is released when the message it belongs to is gone — the
   * history arrives from the server with the server's own URL in its
   * place — and when the page is left.
   */
  const localUrls = useRef(new Set<string>());
  /**
   * How many uploads are in flight.
   *
   * A picture is shown on screen as soon as it is picked, with a local
   * URL — the server's copy does not exist yet. So while the upload is
   * on its way, the poll has nothing to say about that bubble, and it
   * took it away: the user's photo vanished from the screen mid-upload,
   * and its URL was released, so the bubble was left with a broken
   * image.
   */
  const pendingUploads = useRef(0);
  useEffect(() => {
    const urls = localUrls.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);
  useEffect(() => {
    const urls = localUrls.current;
    if (urls.size === 0) return;
    const stillInUse = new Set(
      messages.map((m) => m.mediaUrl).filter((url): url is string => Boolean(url)),
    );
    for (const url of Array.from(urls)) {
      if (!stillInUse.has(url)) {
        URL.revokeObjectURL(url);
        urls.delete(url);
      }
    }
  }, [messages]);
  /**
   * The unsent words (C8.10). They are kept per conversation in the
   * browser, so a reload or a switch to another persona does not throw
   * them away.
   */
  const draft = useDraft(user?.id ?? null, personaId);
  const input = draft.value;
  const setInput = draft.setValue;
  const [isSending, setIsSending] = useState(false);
  /**
   * The stars, pins and topics of this conversation (C8.10).
   */
  const marksQuery = trpc.mark.list.useQuery(
    { personaId },
    { enabled: isAuthenticated && Number.isFinite(personaId) },
  );
  const markList = marksQuery.data?.marks ?? [];
  const addMark = trpc.mark.add.useMutation({
    onSuccess: () => { utils.mark.list.invalidate({ personaId }); },
    onError: (error) => toast.error(error.message),
  });
  const removeMark = trpc.mark.remove.useMutation({
    onSuccess: () => { utils.mark.list.invalidate({ personaId }); },
    onError: (error) => toast.error(error.message),
  });
  const [showMarks, setShowMarks] = useState(false);
  /**
   * Lines taken from the record reader into this turn (C8.10).
   *
   * They arrive through sessionStorage and the URL says only that there
   * is a quotation; the server reads and checks the records again when
   * the turn is sent.
   */
  const [quotedRecords, setQuotedRecords] = useState<QuoteLine[]>([]);
  const [topicTarget, setTopicTarget] = useState<{ messageId: number } | null>(null);
  const [topicName, setTopicName] = useState("");
  const markOf = (messageId: number, kind: "star" | "pin" | "topic") =>
    markList.find((mark) => mark.messageId === messageId && mark.kind === kind);
  const toggleMark = (msg: Message, kind: "star" | "pin") => {
    const messageId = serverMessageId(msg.id);
    if (!Number.isFinite(messageId)) return;
    const existing = markOf(messageId!, kind);
    if (existing) removeMark.mutate({ id: existing.id });
    else addMark.mutate({ personaId, messageId: messageId!, kind });
  };
  const startTopic = (msg: Message) => {
    const messageId = serverMessageId(msg.id);
    if (!Number.isFinite(messageId)) return;
    setTopicName("");
    setTopicTarget({ messageId: messageId! });
  };
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hasQuote = new URLSearchParams(window.location.search).get("quote") === "1";
    if (!hasQuote) return;
    // i18n:allow-identifier — the query flag is a URL marker, not copy.
    setQuotedRecords(readQuoteDraft(personaId));
  }, [personaId]);

  const removeQuote = () => {
    setQuotedRecords([]);
    clearQuoteDraft(personaId);
  };

  const saveTopic = () => {
    if (!topicTarget || !topicName.trim()) return;
    addMark.mutate({
      personaId,
      messageId: topicTarget.messageId,
      kind: "topic",
      label: topicName.trim().slice(0, 60),
    });
    setTopicTarget(null);
    setTopicName("");
  };
  const [liveChoice, setLiveChoice] = useState<{
    options: [string, string];
    replyToMessageId: number;
  } | null>(null);
  const [currentState, setCurrentState] = useState("warm");
  /**
   * The middle of the night (C10.5).
   *
   * The server says so on the turn that knows the session's length; the
   * page then darkens itself and stops moving. It is not a setting and
   * it is not remembered: it belongs to this conversation tonight.
   */
  const [nightMode, setNightMode] = useState(false);
  /**
   * Whether the persona's own words are underlined (C10.7).
   *
   * It is a reading preference, not a persona setting: it lives in
   * localStorage, it defaults to off, and it does not change what the
   * server sends.
   */
  const [provenanceOn, setProvenanceOn] = useState(() => {
    try {
      return localStorage.getItem("mirrai.provenance") === "on";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    // A different conversation is a different night.
    setNightMode(false);
  }, [personaId]);

  const toggleProvenance = useCallback(() => {
    setProvenanceOn((on) => {
      const next = !on;
      try {
        localStorage.setItem("mirrai.provenance", next ? "on" : "off");
      } catch {
        // A browser that refuses storage still gets the switch for this
        // visit.
      }
      return next;
    });
  }, []);

  const [showStatePanel, setShowStatePanel] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [showMenu, setShowMenu] = useState(false);
  const [showAttach, setShowAttach] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [showTimeline, setShowTimeline] = useState(false);
  const [showEmotionReport, setShowEmotionReport] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showScenePanel, setShowScenePanel] = useState(false);
  const [periodId, setPeriodId] = useState("");
  const [showGraduation, setShowGraduation] = useState(false);
  /** The farewell the user starts themselves, rather than one the app offers. */
  const [showManualGraduation, setShowManualGraduation] = useState(false);
  /** A crisis reply is shown with its own card rather than as a bubble. */
  const [showCrisis, setShowCrisis] = useState(false);
  /** Whether there are older messages to load, and whether they are loading. */
  const [hasOlder, setHasOlder] = useState(false);
  /**
   * Whether the conversation has been walked back to its beginning.
   *
   * The poll runs every twenty seconds and only ever knows about the
   * last page. So once the older pages have been read to the end, this
   * is what tells the poll not to offer them again.
   */
  const historyExhausted = useRef(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  /** The notes kept for later are shown once per visit. */
  const [dismissedNotes, setDismissedNotes] = useState(false);
  /** The message the user is replying to. */
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const { data: waitingNotesData } = trpc.letter.todos.useQuery(
    { personaId },
    { enabled: isAuthenticated && hasPersonaId },
  );
  const waitingNotes = waitingNotesData?.todos ?? [];
  const messagesEndRef = useRef<HTMLDivElement>(null);
  /** The list that scrolls. */
  const scrollRef = useRef<HTMLDivElement>(null);
  /**
   * How far the scroll has to move after older messages are added.
   *
   * The older pages are put at the top of the list — so the content
   * under the reader's eyes moves down by the height of the new
   * messages, and the conversation jumps. The user pressed "load
   * older" and was suddenly looking at a different part of it.
   */
  const pendingScrollAdjustment = useRef<{ height: number; top: number } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  /**
   * The microphone is released when the page goes away.
   *
   * The recording was only stopped by the button, so a user who
   * navigated off mid-recording left the microphone open: the browser
   * kept the "recording" dot on, and the stream was never released.
   */
  useEffect(() => {
    return () => {
      // The reply in flight is stopped too.
      //
      // It was not: so navigating away mid-reply left the request
      // running, and the server kept generating an answer that nobody
      // was there to read — and was billed for.
      abortRef.current?.abort();
      abortRef.current = null;
      // The timer that counts the seconds is cleared too: it was only
      // ever cleared by the button, so leaving the page mid-recording
      // left it running for ever.
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      const recorder = mediaRecorderRef.current;
      if (!recorder) return;
      try {
        if (recorder.state !== "inactive") recorder.stop();
      } catch {
        // Already stopped.
      }
      recorder.stream.getTracks().forEach((track) => track.stop());
      mediaRecorderRef.current = null;
    };
  }, []);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /**
   * How many seconds the recording has run.
   *
   * The counter the interface shows lives in state, but the recorder's
   * `onstop` handler is attached once — when the recording starts — so it
   * cannot read a value that changes afterwards. It reads this instead.
   */
  const recordingSecondsRef = useRef(0);
  /** Aborts the latest in-flight streaming request when the user stops the reply. */
  const abortRef = useRef<AbortController | null>(null);
  /** How many sends are still on the wire. The composer stays usable. */
  const inFlightRef = useRef(0);

  // 录音波形高度在一次录音内固定，避免计时每秒重渲染导致跳动
  const recordingBarHeights = useMemo(
    () => (isRecording ? Array.from({ length: 20 }, () => 4 + Math.random() * 16) : []),
    [isRecording]
  );

  useEffect(() => {
    const onOnline = () => { setIsOnline(true); toast.success(t("chat.online")); };
    const onOffline = () => { setIsOnline(false); toast.error(t("chat.offline")); };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [t]);

  const {
    data: persona,
    isError: personaFailed,
    error: personaError,
    refetch: refetchPersona,
  } = trpc.persona.get.useQuery(
    { id: personaId },
    { enabled: isAuthenticated && hasPersonaId }
  );
  const periods = useMemo(
    () => normalizePeriods((persona as { personaData?: { periods?: unknown } } | undefined)?.personaData?.periods),
    [persona],
  );
  const selectedPeriod = useMemo(
    () => periods.find((period) => period.id === periodId) ?? null,
    [periods, periodId],
  );
  const skin = normalizePersonaSettings(persona?.settings).skin ?? { theme: "classic" as const };
  const displayName = skin.alias?.trim() || persona?.name || "";
  /**
   * The way out, reachable from the conversation (C3.3).
   *
   * The list of words the user never said to the real person used to be
   * reachable only from the graduation page. The thought "I never told
   * them this" happens inside the conversation, so the list is now a
   * drawer here too.
   */
  const [showOutbound, setShowOutbound] = useState(false);
  const [showWaitGauge, setShowWaitGauge] = useState(false);
  const [showScheduled, setShowScheduled] = useState(false);
  const collectOutbound = trpc.outbound.addFromMessage.useMutation({
    onSuccess: () => toast.success(t("outbound.keep")),
    onError: (e: any) => toast.error(e.message),
  });
  const handleCollectOutbound = useCallback((message: Message) => {
    const id = Number(message.id);
    if (!Number.isFinite(id)) return;
    collectOutbound.mutate({ personaId, messageId: id });
  }, [collectOutbound, personaId]);
  const memorialMode = normalizePersonaSettings(persona?.settings).mode === "memorial";

  /**
   * A farewell the app has already offered.
   *
   * The window used to open on the live flag of the turn that produced
   * the offer — so an offer that came from a channel (WeChat, Feishu)
   * never reached the web. The decision is recorded, and the seven-day
   * cooldown hid it for a week.
   *
   * There is a query for exactly this state, and nothing called it.
   */
  /**
   * Waking a persona that has said goodbye.
   *
   * The notice says to do it, so the control is here.
   */
  const awakenMutation = trpc.persona.awaken.useMutation({
    onSuccess: () => {
      toast.success(t("lobby.card.awakened", { name: persona?.name || "" }));
      utils.persona.get.invalidate({ id: personaId });
      utils.persona.checkGraduation.invalidate({ id: personaId });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const { data: graduationCheck } = trpc.persona.checkGraduation.useQuery(
    { id: personaId },
    {
      enabled: isAuthenticated && hasPersonaId,
      // The offer can be raised from a channel while the web is open.
      refetchInterval: 60_000,
    }
  );
  useEffect(() => {
    /**
     * Only an offer that has been *recorded*.
     *
     * The query also answers "would the thresholds be met right now" —
     * and the app does not raise a farewell on its own schedule: the
     * conversation pipeline decides, and the decision is written down.
     * So the window opens for a recorded offer, not for a threshold.
     */
    if (graduationCheck?.status === "suggested") setShowGraduation(true);
  }, [graduationCheck?.status]);

  /**
   * The clock that moves.
   *
   * The time on their side of the world was worked out once — when the
   * page loaded — and never again. So a conversation left open in the
   * evening still said it was afternoon there at two in the morning,
   * and the notice that they are asleep never appeared.
   */
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  /* The time on their side of the world. */
  const theirClock = useMemo(() => {
    const zone = (persona as any)?.timezone;
    if (!zone) return null;
    try {
      return formatZonedClock(new Date(nowTick), zone, locale === "en" ? "en" : "zh");
    } catch {
      return null;
    }
  }, [(persona as any)?.timezone, locale, nowTick]);

  /* Whether it is the middle of the night where they are. */
  const theyAreAsleep = useMemo(() => {
    const zone = (persona as any)?.timezone;
    if (!zone) return false;
    const hour = zonedHour(new Date(nowTick), zone);
    return hour >= 0 && hour < 7;
  }, [(persona as any)?.timezone, nowTick]);

  /* How long since you last spoke. A number, because that is what the
     question is: "how long has it been". */
  const daysSinceTalk = useMemo(
    /**
     * The days since the *user* spoke.
     *
     * It used to read the last time anything was written — and the
     * app's own nightly message reset it, so the counter read 0 while
     * the user had not spoken for a week.
     */
    () => daysSinceContact((persona as any)?.lastUserMessageAt ?? (persona as any)?.lastChatAt),
    [(persona as any)?.lastUserMessageAt, (persona as any)?.lastChatAt],
  );

  /**
   * Whether the user's own taper (C6.1) or a seal (C6.2) closes the
   * chat right now. Computed on the clock that ticks above, so a page
   * left open overnight follows the user's own calendar.
   */
  const chatState = mayChatNow(
    { settings: persona?.settings, presence: persona?.presence, graduationStatus: persona?.graduationStatus },
    new Date(nowTick),
    user?.timezone ?? null,
  );

  const { data: intimacy } = trpc.persona.getIntimacy.useQuery(
    { id: personaId },
    { enabled: isAuthenticated && hasPersonaId }
  );

  /* The graduation mode decides whether the app may offer a farewell and
     whether the user may start one from here. */
  const { data: graduation } = trpc.persona.graduationMode.useQuery(
    { id: personaId },
    { enabled: isAuthenticated && hasPersonaId }
  );
  const graduationMode = graduation?.mode ?? "suggest";

  /**
   * The history, polled.
   *
   * Two things write to this conversation while the user is not typing
   * in it: the persona speaking first, and a letter being answered. Both
   * of them happen in the background, and without polling the message
   * would sit in the database until the page was reloaded — which
   * turns "TA 先开口" into something you find out about the next morning.
   *
   * React Query does not poll a hidden tab, so a backgrounded window
   * costs nothing.
   */
  const { data: history, isError: historyFailed, refetch: refetchHistory } = trpc.chat.getHistory.useQuery(
    { personaId },
    {
      enabled: isAuthenticated && hasPersonaId,
      refetchInterval: 20_000,
      refetchIntervalInBackground: false,
    }
  );

  const clearMutation = trpc.chat.clear.useMutation({
    onSuccess: () => { setMessages([]); toast.success(t("chat.cleared")); setShowMenu(false); },
    onError: (e: any) => toast.error(e.message),
  });

  /* The message-level operations. Without them a conversation is a
     transcript: nothing can be repeated, fixed or taken back. */
  const updateMessageMutation = trpc.chat.updateMessage.useMutation();
  const deleteMessageMutation = trpc.chat.deleteMessage.useMutation();
  /**
   * The undo of a message deletion (C8.11).
   *
   * The message goes to the bin; the bar at the bottom offers the way
   * back for ten seconds, and putting it back reloads the conversation
   * from the server rather than guessing where the row belonged.
   */
  const restoreMessageMutation = trpc.chat.restoreMessage.useMutation();
  const undo = useUndoToast();
  const utils = trpc.useUtils();

  /**
   * A mutation that can be aborted.
   *
   * The React hooks capture their request options when they are created,
   * so a per-call signal cannot be threaded through them. The client can:
   * `utils.client.mutation` takes the request options — including the
   * signal — on every call.
   */
  const abortableMutation = useCallback(
    (path: string, input: unknown, signal: AbortSignal): Promise<any> =>
      (utils.client as any).mutation(path, input, { signal }),
    [utils.client],
  );

  /**
   * The scene list is read here for two things that are not the panel:
   * the header's active-scene chip and the scene's opening lines. The
   * panel itself reads and writes its own copy of the list.
   */
  const { data: scenesList } = trpc.scene.list.useQuery(undefined, { enabled: isAuthenticated });

  const activeScene = scenesList?.find((s: any) => s.id === persona?.activeSceneId);

  const changeStateMutation = trpc.persona.update.useMutation({
    onSuccess: () => toast.success(t("chat.stateChanged")),
    /**
     * The mood goes back when the write fails.
     *
     * The chip changed the moment it was clicked — so a failed write
     * left the header showing a mood the persona does not have, and
     * said nothing about it. The next persona refetch reverted it
     * silently.
     */
    onError: (e: any) => {
      toast.error(e.message);
      setCurrentState(persona?.emotionalState || "warm");
    },
  });

  const exportMutation = trpc.chat.export.useMutation();

  const handleExport = async () => {
    try {
      const result = await exportMutation.mutateAsync({
        personaId,
        locale: locale === "en" ? "en" : "zh",
      });
      const blob = new Blob([result.html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      /**
       * The URL is released a moment later.
       *
       * It was released straight away — and the browser may not have
       * started the download by then, so the file arrived empty or not
       * at all.
       */
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(t("chat.exportSuccess"));
    } catch (e: any) { toast.error(t("chat.exportFailed", { message: e.message })); }
  };

  useEffect(() => {
    if (!history) return;

    // The quoted text is resolved from the messages themselves, so the
    // bubble can show what it is answering.
    const byId = new Map(history.map((m: any) => [m.id, m]));

    // The memories a turn recalled. The server writes them down, so the
    // answer to "did it recall that or invent it?" is still there after a
    // reload — it used to live only in the live stream.
    const fromServer = history.map((m: any) => ({
      id: m.id, role: m.role as "user" | "assistant",
      content: m.content, messageType: m.messageType, mediaUrl: m.mediaUrl, mediaDuration: m.mediaDuration,
      kind: m.metadata?.kind ?? null,
      emotionalState: m.emotionalState, channel: m.channel, createdAt: m.createdAt,
      origin: originFromHistory(m),
      replyToId: m.replyToId ?? null,
      replyToContent: m.replyToId ? (byId.get(m.replyToId)?.content ?? null) : null,
      recalled: (m.recalled ?? []).filter((r: any) => r.title),
      pendingChoice: pendingChoiceFromMetadata(m.metadata),
      routine: routineFromMetadata(m.metadata),
      claims: claimsFromMetadata(m.metadata),
      photoAt: photoAtFromMetadata(m.metadata),
      provenance: provenanceFromMetadata(m.metadata),
      quotedRecords: Array.isArray(m.quotedRecords) ? m.quotedRecords : [],
    }));

    // The history is polled, so it can arrive while a reply is still
    // being written. Replacing the list would wipe the half-written
    // message, so the local ones the server does not know about yet are
    // kept.
    //
    // The older pages the user loaded are kept too. They are the last
    // fifty messages' predecessors, so the server does not send them
    // again — and the poll used to delete them, which meant the history
    // the user had just asked for was gone twenty seconds later.
    setMessages((prev) => {
      const known = new Set(fromServer.map((m) => m.id));
      // Messages with a real id that the server has not sent: the
      // earlier pages.
      const older = prev.filter((m) => !known.has(m.id) && typeof m.id === "number");
      // The ones still being written.
      const pending = prev.filter((m) => !known.has(m.id) && m.isStreaming);
      /**
       * The uploads that are still on their way.
       *
       * A picture is on screen with a local URL — the server's copy
       * does not exist until the upload has finished. So the poll, which
       * knows nothing about it, took the bubble away in the middle:
       * the user's photo vanished from the screen, and its URL was
       * released, so the bubble was left with a broken image.
       */
      const uploading = pendingUploads.current > 0
        ? prev.filter((m) => !known.has(m.id) && typeof m.id === "string" && !m.isStreaming && m.mediaUrl)
        : [];
      if (older.length === 0 && pending.length === 0 && uploading.length === 0) return fromServer;
      return [...older, ...fromServer, ...pending, ...uploading];
    });
    /**
     * A full page of history means there is probably more behind it.
     *
     * But only while the older pages have not been walked to the end:
     * the poll used to put the button back every twenty seconds after
     * the user had reached the beginning of the conversation, so a
     * button that does nothing kept reappearing.
     */
    setHasOlder(history.length >= 50 && !historyExhausted.current);
  }, [history]);

  useEffect(() => {
    if (persona?.emotionalState) setCurrentState(persona.emotionalState);
  }, [persona?.emotionalState]);

  /**
   * The scroll is put back after older messages are added.
   *
   * The layout effect runs after the list has been laid out, which is
   * the only moment the new height is known.
   */
  useLayoutEffect(() => {
    const saved = pendingScrollAdjustment.current;
    if (!saved) return;
    pendingScrollAdjustment.current = null;
    const after = scrollRef.current;
    if (!after) return;
    after.scrollTop = saved.top + (after.scrollHeight - saved.height);
  }, [messages]);

  /**
   * Keeps the newest message in view — but only when the newest message
   * has actually changed.
   *
   * Loading older messages *prepends* to the list, and the list is the
   * only thing this effect watches. It therefore scrolled to the bottom
   * every time the user asked for more history, which threw away the
   * place they had scrolled to and made the history impossible to read.
   *
   * The length is watched as well as the id, because a reply that is
   * still arriving grows without becoming a different message — and that
   * is exactly when the view should follow it down.
   */
  /**
   * A new persona starts from nothing.
   *
   * `/chat/:id` is one route, so React reuses the component when the
   * user moves from one persona to another — and every piece of state
   * survived the move. So:
   *
   * - the draft typed for the first persona was sent to the second;
   * - the first persona's crisis card was still on screen;
   * - the first persona's transcript was briefly shown under the
   *   second one's header;
   * - and, worst of all, `historyExhausted` stayed true — so the
   *   "load older messages" button never appeared for the second
   *   persona, and its history was unreachable.
   */
  const lastMessageRef = useRef<{ id: string | number | null; length: number }>({
    id: null,
    length: 0,
  });
  useEffect(() => {
    setMessages([]);
    // The draft of the conversation being opened is loaded by the hook;
    // blanking the input here would delete it (C8.10).
    setLiveChoice(null);
    setReplyTo(null);
    setShowCrisis(false);
    setShowGraduation(false);
    setShowManualGraduation(false);
    setHasOlder(false);
    setDismissedNotes(false);
    historyExhausted.current = false;
    lastMessageRef.current = { id: null, length: 0 };
  }, [personaId]);

  useEffect(() => {
    const last = messages.length > 0 ? messages[messages.length - 1] : null;
    const id = last ? last.id : null;
    const length = last ? last.content.length : 0;
    const changed = id !== lastMessageRef.current.id || length !== lastMessageRef.current.length;
    lastMessageRef.current = { id, length };
    if (!changed) return;
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    // The quotation has been spent by this turn (C8.10).
    if (quotedRecords.length > 0) {
      clearQuoteDraft(personaId);
      setQuotedRecords([]);
    }
    setLiveChoice(null);
    inFlightRef.current += 1;
    setIsSending(true);

    const quotedIds = quotedRecords.map((row) => row.id);
    const userMsg: Message = {
      id: `temp-${Date.now()}`,
      role: "user",
      content: text,
      createdAt: new Date(),
      ...(quotedRecords.length > 0
        ? { quotedRecords: quotedRecords.map((row) => ({ ...row })) }
        : {}),
    };
    setMessages(prev => [...prev, userMsg]);

    // The message being replied to has been spent.
    //
    // It used to be cleared only on the fallback path — the one taken
    // against a server that has no streaming route — so on every ordinary
    // send the "replying to…" strip stayed on screen and the *next*
    // message was sent as a reply to the message before it. The persona
    // answered the wrong question.
    setReplyTo(null);

    const streamId = `stream-${Date.now()}`;
    setMessages(prev => [...prev, { id: streamId, role: "assistant", content: "", isStreaming: true, emotionalState: currentState }]);

    const controller = new AbortController();
    abortRef.current = controller;

    /**
     * What has arrived so far.
     *
     * The catch block used to look the partial answer up in the message
     * list — but the list it saw was the one from the render in which the
     * send started, so it never contained the reply that had been
     * streaming in. "Half an answer is still worth keeping" was therefore
     * true only in the comment: every interrupted reply was thrown away.
     */
    let received = "";
    let thinking = false;

    const appendDelta = (chunk: string) => {
      received += chunk;
      setMessages(prev => prev.map(m => m.id === streamId ? { ...m, content: m.content + chunk } : m));
    };

    try {
      try {
        await streamChat({
          personaId,
          message: text,
          locale: locale === "en" ? "en" : "zh",
          replyToId: serverMessageId(replyTo?.id),
          ...(quotedIds.length > 0 ? { quotedRecordIds: quotedIds } : {}),
          periodId: periodId || undefined,
          signal: controller.signal,
          callbacks: {
            onDelta: (chunk) => {
              if (thinking) {
                thinking = false;
                received = chunk;
                setMessages(prev => prev.map(m => m.id === streamId ? { ...m, content: chunk } : m));
                return;
              }
              appendDelta(chunk);
            },
            onThinking: (notice) => {
              thinking = true;
              setMessages(prev => prev.map(m => m.id === streamId
                ? { ...m, content: notice || t("chat.thinking"), isStreaming: true }
                : m));
            },
            onDelay: (ms, typingMs) => revealDelay({
              ms,
              typingMs,
              signal: controller.signal,
              setDots: (on) => {
                setMessages((prev) => prev.map((m) => (
                  m.id === streamId ? { ...m, isTyping: on, isStreaming: true } : m
                )));
              },
            }),
            onSilence: (notice) => {
              setMessages(prev => prev.map(m => m.id === streamId
                ? {
                    ...m,
                    content: notice || t("chat.didNotReply"),
                    origin: "system-notice",
                    isStreaming: false,
                  }
                : m));
            },
            onBurst: (texts, extra) => revealBurst({
              texts,
              gapsMs: extra?.gapsMs,
              typingMs: extra?.typingMs,
              signal: controller.signal,
              setDots: (on) => {
                setMessages((prev) => prev.map((m) => (
                  m.id === streamId ? { ...m, isTyping: on, isStreaming: true } : m
                )));
              },
              show: (parts) => {
                setMessages((prev) => {
                  const others = prev.filter((m) => (
                    m.id !== streamId
                    && !(typeof m.id === "string" && m.id.startsWith(`burst-${streamId}-`))
                  ));
                  const complete = parts.length === texts.length;
                  const bubbles: Message[] = parts.map((part, index) => ({
                    id: complete && index === parts.length - 1 ? streamId : `burst-${streamId}-${index}`,
                    role: "assistant",
                    content: part,
                    isStreaming: complete && index === parts.length - 1,
                    emotionalState: currentState,
                    createdAt: new Date(),
                  }));
                  if (!complete) {
                    bubbles.push({
                      id: streamId,
                      role: "assistant",
                      content: "",
                      isStreaming: true,
                      isTyping: false,
                      emotionalState: currentState,
                      createdAt: new Date(),
                    });
                  }
                  return [...others, ...bubbles];
                });
              },
            }),
            onEmotion: (state) => {
              setCurrentState(state);
              setMessages(prev => prev.map(m => m.id === streamId ? { ...m, emotionalState: state } : m));
            },
            onReplace: (text) => {
              received = text;
              setMessages(prev => prev.map(m => m.id === streamId ? { ...m, content: text } : m));
            },
            onChoice: (info) => {
              setLiveChoice(info);
              setMessages((prev) => prev.filter((m) => m.id !== streamId));
            },
            onDone: (info) => {
              setMessages(prev => [...prev.map(m => m.id === streamId
                ? {
                    ...m,
                    id: `ai-${info.messageId}`,
                    // A voice note carries its words in `done.voice`;
                    // no text delta was sent, so an empty stream bubble
                    // would otherwise become "（沉默）".
                    content: info.voice?.content || m.content || t("chat.silence"),
                    emotionalState: info.emotionalState,
                    createdAt: new Date(),
                    isStreaming: false,
                    recalled: info.recalled,
                    provenance: info.provenance ?? undefined,
                    routine: info.routine ?? null,
                    claims: (info.claims ?? []).map((row) => ({
                      text: row.text,
                      supported: row.supported,
                      date: row.source?.at ?? null,
                    })),
                    ...(info.voice
                      ? {
                          messageType: "voice" as const,
                          mediaUrl: info.voice.url,
                          mediaDuration: info.voice.durationSec,
                          kind: "voice-note",
                        }
                      : {}),
                  }
                : m
              ), ...extraBubbles(info.extra, info.emotionalState)]);
              setCurrentState(info.emotionalState);
              if (info.graduationSuggested) setShowGraduation(true);
              if (info.careNote?.showBanner) toast.info(careBannerText(info.careNote, t));
              // A crisis reply is not an ordinary bubble. The server says
              // so, and the flag was defined all the way back in the stream
              // protocol — but nothing read it, so the most serious moment
              // the app handles looked exactly like any other message.
              if (info.crisis) setShowCrisis(true);
              if (info.lateNight) setNightMode(true);
            },
            onError: (message) => {
              toast.error(t("chat.interrupted", { message }));
              setMessages(prev => prev.map(m => m.id === streamId ? { ...m, isStreaming: false } : m));
            },
            onSuperseded: () => {
              setMessages((prev) => prev.filter((m) => m.id !== streamId));
            },
            onDeferred: () => {
              setMessages((prev) => prev.filter((m) => m.id !== streamId));
              void utils.chat.pendingReply.invalidate({ personaId });
            },
            onRecall: async (text, showMs) => {
              const recallId = `recall-${streamId}`;
              const name = persona?.name || "?";
              setMessages((prev) => {
                const without = prev.filter((m) => m.id !== recallId);
                const idx = without.findIndex((m) => m.id === streamId);
                const bubble: Message = {
                  id: recallId,
                  role: "assistant",
                  content: text,
                  isStreaming: false,
                  createdAt: new Date(),
                };
                if (idx < 0) return [...without, bubble];
                return [...without.slice(0, idx), bubble, ...without.slice(idx)];
              });
              await waitMs(showMs, controller.signal);
              setMessages((prev) => prev.map((m) => (
                m.id !== recallId
                  ? m
                  : {
                      ...m,
                      content: t("chat.recallNotice", { name }),
                      origin: "recall",
                    }
              )));
            },
            onPat: () => {
              const patId = `pat-${streamId}`;
              const name = persona?.name || "?";
              setMessages((prev) => {
                if (prev.some((m) => m.id === patId)) return prev;
                const idx = prev.findIndex((m) => m.id === streamId);
                const bubble: Message = {
                  id: patId,
                  role: "assistant",
                  content: t("chat.patNotice", { name }),
                  origin: "pat",
                  isStreaming: false,
                  createdAt: new Date(),
                };
                if (idx < 0) return [...prev, bubble];
                return [...prev.slice(0, idx), bubble, ...prev.slice(idx)];
              });
            },
          },
        });
      } catch (err) {
        // A server without the streaming route still works through the
        // ordinary mutation.
        const status = (err as { status?: number })?.status;
        if (!isStreamingUnsupported(status ?? 0)) throw err;

        const result = await abortableMutation(
          "chat.send",
          {
            personaId,
            message: text,
            locale: locale === "en" ? "en" : "zh",
            replyToId: serverMessageId(replyTo?.id),
            periodId: periodId || undefined,
          },
          controller.signal,
        ) as any;
        /**
         * The turn failed — and the message was sent.
         *
         * The server says so: the user's own message is in the
         * transcript, because it is stored before the model is called.
         * The channels rely on that (a person who wrote a message on
         * WeChat cannot have it put back in a composer), and the
         * streaming path keeps it too.
         *
         * So the bubble stays and the text does not go back into the
         * composer. Taking the bubble away *and* saying "the server did
         * not store the message" was a claim that was simply false —
         * and twenty seconds later the poll brought the message back on
         * its own, or the user had retyped it and the transcript had it
         * twice.
         */
        if (failedSendKeepsTheMessage(result)) {
          toast.error(t("chat.failed", { message: t("errors.replyFailed") }));
          setMessages(prev => prev.map(m => (m.id === streamId ? { ...m, isStreaming: false } : m)));
          return;
        }
        if (result.superseded || result.deferred) {
          setMessages((prev) => prev.filter((m) => m.id !== streamId));
          if (result.deferred) void utils.chat.pendingReply.invalidate({ personaId });
          return;
        }
        if (result.choice?.options?.length >= 2 && typeof result.choice.replyToMessageId === "number") {
          setLiveChoice({
            options: [result.choice.options[0], result.choice.options[1]],
            replyToMessageId: result.choice.replyToMessageId,
          });
          setMessages((prev) => prev.filter((m) => m.id !== streamId));
          return;
        }
        setMessages(prev => [...prev.map(m => m.id === streamId
          ? {
              id: `ai-${Date.now()}`,
              role: "assistant" as const,
              content: result.reply,
              emotionalState: result.emotionalState,
              createdAt: new Date(),
              isStreaming: false,
              ...(result.voice
                ? {
                    messageType: "voice" as const,
                    mediaUrl: result.voice.url,
                    mediaDuration: result.voice.durationSec,
                    kind: "voice-note",
                  }
                : {}),
            }
          : m
        ), ...extraBubbles((result as { extra?: ExtraMessage[] }).extra, result.emotionalState)]);
        setCurrentState(result.emotionalState);
        if (result.graduationSuggested) setShowGraduation(true);
        /**
         * The crisis card.
         *
         * It was missing on this path — the image and the voice paths
         * show it, and the streaming path shows it. So on a server
         * without the streaming route, a crisis reply arrived as an
         * ordinary bubble with no support resources at all: the one
         * moment the app exists for, and the one moment it said
         * nothing.
         */
        if (result.crisis) setShowCrisis(true);
        if ((result as { lateNight?: boolean }).lateNight) setNightMode(true);
        if (result.careNote?.showBanner) toast.info(careBannerText(result.careNote, t));
      }
    } catch (err) {
      // A failed send used to disappear without a word: the bubble was
      // removed and the user was left wondering whether their message had
      // gone. Half an answer is still worth keeping.
      if (received) {
        setMessages(prev => prev.map((m) => (m.id === streamId ? { ...m, isStreaming: false } : m)));
        toast.error(t("chat.interrupted", { message: (err as Error)?.message ?? "" }));
      } else {
        /**
         * The bubbles go, and the text goes back into the composer.
         *
         * The server did not store the message, so a bubble would be a
         * claim that it was sent — and the next poll would take it away
         * anyway, twenty seconds later, with no explanation.
         */
        setMessages(prev => prev.filter(m => m.id !== streamId && m.id !== userMsg.id));
        /**
         * The text goes back into the composer.
         *
         * The composer was emptied before the request — and the most
         * common failure is the one the user hits by accident: the rate
         * limit, "you are sending too fast". So the message was typed,
         * sent, refused, and gone: the user had to write it again.
         *
         * The message itself is not put back as a bubble: the server
         * did not store it, so a bubble would be a claim that the
         * message was sent.
         */
        setInput(text);
        toast.error(t("chat.failed", { message: (err as Error)?.message ?? t("errors.unknown") }));
      }
    } finally {
      inFlightRef.current = Math.max(0, inFlightRef.current - 1);
      if (abortRef.current === controller) abortRef.current = null;
      setIsSending(inFlightRef.current > 0);
      textareaRef.current?.focus();
    }
  };

  /**
   * Replies to a particular message.
   *
   * Without it every reply is a reply to "whatever came last", and a
   * long conversation becomes impossible to follow.
   */
  const handleQuote = useCallback((msg: Message) => {
    setReplyTo(msg);
    textareaRef.current?.focus();
  }, []);

  /**
   * How many messages the regeneration would take with it.
   *
   * The count of the messages *after* the one being regenerated — the
   * user's own words and the answers that followed.
   */
  const messagesAfter = useCallback((id: number) => {
    const index = messages.findIndex((m) => m.id === id);
    if (index < 0) return 0;
    return Math.max(0, messages.length - index - 1);
  }, [messages]);

  /**
   * Asks the persona again, replacing the turn that is on screen.
   *
   * The server removes the old turn and everything after it, so the
   * conversation does not end up with two different answers to the same
   * question.
   */
  const handleRegenerate = useCallback(async (msg: Message) => {
    if (isSending) return;
    // A message that is still streaming has no id of its own yet.
    if (typeof msg.id !== "number") return;
    /**
     * The confirmation.
     *
     * The server removes the turn and *everything after it* — so
     * regenerating an answer from the middle of a conversation takes the
     * rest of that relationship's transcript with it, including the
     * user's own words, and there is no way back.
     *
     * Every other destructive action in the app asks first. This one
     * did not, and the button's own description said it was "replacing
     * the turn that is on screen" — which is not what it does.
     */
    const yes = await confirm({
      description: t("chat.regenerateConfirm", { count: messagesAfter(msg.id) }),
    });
    if (!yes) return;
    setIsSending(true);
    // The stop button works here too.
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await abortableMutation(
        "chat.regenerate",
        {
          personaId,
          messageId: msg.id,
          locale: locale === "en" ? "en" : "zh",
        },
        controller.signal,
      );
      // Drop the old turn from the screen and show the new answer.
      //
      // The turn that is being replaced is the user's question *and* the
      // answer that followed it. The old code replaced the question
      // itself with the answer, so the user's own words disappeared and
      // the answer appeared in the user's bubble — until the next poll
      // rewrote the list and the transcript was right again.
      setMessages(prev => {
        const index = prev.findIndex((m) => m.id === msg.id);
        if (index < 0) return prev;
        const userIndex = lastUserMessageIndex(prev, index);
        const cut = userIndex >= 0 ? userIndex : index;
        const question = prev[cut];
        return [
          ...prev.slice(0, cut),
          question,
          {
            id: `ai-${Date.now()}`,
            role: "assistant",
            content: result.reply,
            emotionalState: result.emotionalState,
            createdAt: new Date(),
            isStreaming: false,
          },
        ];
      });
      setCurrentState(result.emotionalState);
      // A crisis reply is not an ordinary bubble — the card shows the
      // support resources.
      if (result.crisis) setShowCrisis(true);
      await utils.chat.getHistory.invalidate({ personaId });
    } catch (e) {
      if (controller.signal.aborted) {
        toast.info(t("chat.interrupted", { message: "" }));
      } else {
        toast.error((e as Error)?.message || t("errors.unknown"));
      }
    } finally {
      abortRef.current = null;
      setIsSending(false);
    }
  }, [isSending, personaId, locale, abortableMutation, t, utils.chat.getHistory, messagesAfter]);

  /** Saves an edited message. */
  const handleEditMessage = useCallback(async (msg: Message, content: string) => {
    if (typeof msg.id !== "number") return;
    /**
     * The failure is reported, and the editor stays open.
     *
     * The bubble closes the editor once this settles — so the error
     * has to be thrown rather than swallowed, or the editor would
     * close over a save that never happened.
     */
    try {
      await updateMessageMutation.mutateAsync({
        personaId,
        messageId: msg.id,
        content,
      });
      setMessages(prev => prev.map((m) => (m.id === msg.id ? { ...m, content } : m)));
    } catch (e) {
      toast.error((e as Error)?.message || t("errors.unknown"));
      throw e;
    }
  }, [personaId, updateMessageMutation, t]);

  /** Removes a single message. */
  const handleDeleteMessage = useCallback(async (msg: Message) => {
    if (typeof msg.id !== "number") return;
    /**
     * It asks first.
     *
     * Every other destructive action in the app asks — a letter, a
     * relationship record, a memory, a diary entry. A message went
     * with one click and nothing said.
     */
    const yes = await confirm({ description: t("chat.deleteConfirm") });
    if (!yes) return;
    try {
      await deleteMessageMutation.mutateAsync({
        personaId,
        messageId: msg.id,
      });
      setMessages(prev => prev.filter((m) => m.id !== msg.id));
      undo.showUndo({
        onUndo: async () => {
          await restoreMessageMutation.mutateAsync({
            personaId,
            messageId: msg.id as number,
          });
          // The conversation is read again rather than patched by
          // hand, so the restored row lands where the server put it.
          await refetchHistory();
        },
      });
    } catch (e) {
      toast.error((e as Error)?.message || t("errors.unknown"));
    }
  }, [personaId, deleteMessageMutation, restoreMessageMutation, undo, refetchHistory, t]);

  /**
   * Loads the messages before the oldest one on screen.
   *
   * The page used to load the last fifty messages and stop, so a long
   * conversation had no beginning — everything was in the database with
   * no way to reach it.
   */
  const loadOlderMessages = useCallback(async () => {
    if (loadingOlder) return;
    const oldest = messages.find((m) => typeof m.id === "number");
    if (!oldest) return;
    setLoadingOlder(true);
    // Where the reader is now, and how tall the list is.
    const container = scrollRef.current;
    const heightBefore = container?.scrollHeight ?? 0;
    const topBefore = container?.scrollTop ?? 0;
    try {
      const older = await utils.chat.getHistory.fetch({
        personaId,
        before: oldest.id as number,
        limit: 50,
      });
      if (older.length > 0) {
        /**
         * The scroll is put back.
         *
         * The older pages go at the top of the list, so everything
         * under the reader's eyes moves down — and the conversation
         * jumped. The user pressed "load older" and was suddenly
         * looking at a different part of it.
         */
        pendingScrollAdjustment.current = { height: heightBefore, top: topBefore };
        setMessages(prev => {
          const known = new Set(prev.map((m) => m.id));
          const fresh = (older as any[])
            .filter((m) => !known.has(m.id))
            .map((m) => ({
              id: m.id, role: m.role as "user" | "assistant",
              content: m.content, messageType: m.messageType, mediaUrl: m.mediaUrl,
              mediaDuration: m.mediaDuration, kind: m.metadata?.kind ?? null,
              emotionalState: m.emotionalState,
              channel: m.channel, createdAt: m.createdAt,
            }));
          return [...fresh, ...prev];
        });
        historyExhausted.current = older.length < 50;
        setHasOlder(older.length >= 50);
      } else {
        // There is nothing before the oldest message on screen.
        historyExhausted.current = true;
        setHasOlder(false);
      }
    } catch (e) {
      toast.error((e as Error)?.message || t("errors.unknown"));
    } finally {
      setLoadingOlder(false);
    }
  }, [loadingOlder, messages, personaId, t, utils.chat.getHistory]);

  /**
   * Scrolls to a message and highlights it.
   *
   * A search result that only closes the panel is a search that found
   * something and then hid it again.
   */
  const jumpToMessage = useCallback((messageId: number) => {
    setTimeout(() => {
      const element = document.querySelector(`[data-message-id="${messageId}"]`);
      if (!element) {
        toast.info(t("chat.messageNotLoaded"));
        return;
      }
      element.scrollIntoView({ behavior: "smooth", block: "center" });
      element.classList.add("ring-2", "ring-primary/50", "rounded-lg");
      setTimeout(() => {
        element.classList.remove("ring-2", "ring-primary/50", "rounded-lg");
      }, 2200);
    }, 60);
  }, [t]);

  const jumpedHash = useRef(false);
  useEffect(() => {
    if (jumpedHash.current) return;
    const match = /^#m-(\d+)$/.exec(window.location.hash);
    if (!match) return;
    const id = Number(match[1]);
    if (!messages.some((m) => m.id === id || m.id === `ai-${id}`)) return;
    jumpedHash.current = true;
    jumpToMessage(id);
  }, [messages, jumpToMessage]);

  /** Stops an in-flight streaming reply. */
  const handleStopStreaming = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleImageSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    /**
     * The input is emptied first.
     *
     * It used to be emptied at the very end — so when the pick was
     * refused the input still held the file, and choosing the same one
     * again did not even fire the change. The file appeared to have
     * been selected and nothing happened.
     */
    e.target.value = "";
    if (!file) return;
    if (isSending) {
      toast.info(t("chat.sendInFlight"));
      return;
    }
    /**
     * The kind and the size are checked before the file is read.
     *
     * The file used to be read into memory first — so a file of any
     * size could take the tab with it, and a file the server would
     * refuse came back as a raw English validation message in a
     * Chinese interface.
     */
    if (!file.type.startsWith("image/")) {
      toast.error(t("chat.imageNotAnImage", { name: file.name }));
      return;
    }
    if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
      toast.error(t("chat.imageTooLarge", {
        name: file.name,
        limit: `${Math.round(MAX_IMAGE_UPLOAD_BYTES / 1024 / 1024)} MB`,
      }));
      return;
    }
    setShowAttach(false);
    setIsSending(true);
    // The stop button used to be a no-op on this path: the controller was
    // only ever created for the streaming text send.
    const controller = new AbortController();
    abortRef.current = controller;

    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = (reader.result as string).split(",")[1];
      const localUrl = URL.createObjectURL(file);
      localUrls.current.add(localUrl);
      pendingUploads.current += 1;
      const userMsg: Message = { id: `temp-${Date.now()}`, role: "user", content: t("chat.imageMessage"), messageType: "image", mediaUrl: localUrl, createdAt: new Date() };
      setMessages(prev => [...prev, userMsg]);
      const streamId = `stream-${Date.now()}`;
      setMessages(prev => [...prev, { id: streamId, role: "assistant", content: "", isStreaming: true, emotionalState: currentState }]);

      try {
        const result = await abortableMutation(
          "chat.sendImage",
          {
            personaId,
            imageContent: base64,
            fileName: file.name,
            mimeType: file.type,
            /**
             * The language the persona answers in.
             *
             * It was not sent — and the server defaults it to Chinese.
             * So an English user's photo was answered in Chinese, with
             * a Chinese care note and a Chinese crisis response.
             */
            locale: locale === "en" ? "en" : "zh",
          },
          controller.signal,
        );
        if (result.superseded || result.deferred) {
          setMessages((prev) => prev.filter((m) => m.id !== streamId));
          if (result.deferred) void utils.chat.pendingReply.invalidate({ personaId });
        } else {
          setMessages(prev => [...prev.map(m => m.id === streamId
            ? { id: `ai-${Date.now()}`, role: "assistant" as const, content: result.reply, emotionalState: result.emotionalState, createdAt: new Date(), isStreaming: false }
            : m
          ), ...extraBubbles((result as { extra?: ExtraMessage[] }).extra, result.emotionalState)]);
          setCurrentState(result.emotionalState);
          if (result.careNote?.showBanner) toast.info(careBannerText(result.careNote, t));
          if (result.crisis) setShowCrisis(true);
        }
      } catch (err) {
        // A failed send used to vanish without a word.
        setMessages(prev => prev.filter(m => m.id !== streamId));
        if (controller.signal.aborted) {
          toast.info(t("chat.interrupted", { message: "" }));
        } else {
          toast.error(t("chat.imageFailed", { message: (err as Error)?.message ?? t("errors.unknown") }));
        }
      }
      finally {
        abortRef.current = null;
        // The upload is done — the server's copy of the picture exists
        // now, and the poll will bring it.
        pendingUploads.current = Math.max(0, pendingUploads.current - 1);
        setIsSending(false);
      }
    };
    reader.readAsDataURL(file);
    // `t` is in the list because the handler says things to the reader:
    // without it, a picture sent after a change of language was
    // described in the language that had been in use before.
  }, [isSending, personaId, currentState, t, locale]);

  const startRecording = useCallback(async () => {
    // The stop button has to work on this path too.
    const voiceController = new AbortController();
    abortRef.current = voiceController;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      /**
       * The recorder.
       *
       * The type is asked for rather than demanded: Safari does not
       * record `audio/webm`, and asking for a format it cannot make
       * throws — so the microphone button was simply broken there.
       */
      const recorder = MediaRecorder.isTypeSupported("audio/webm")
        ? new MediaRecorder(stream, { mimeType: "audio/webm" })
        : new MediaRecorder(stream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        const reader = new FileReader();
        reader.onload = async () => {
          const base64 = (reader.result as string).split(",")[1];
          // How long the recording was.
          //
          // It used to be read from the `recordingTime` state, which the
          // `onstop` handler could not see: the handler was attached when
          // the recording started, so it closed over the value from then —
          // zero. Every voice message was stored and sent as being no
          // length at all, and the waveform in the bubble was a lie.
          const duration = recordingSecondsRef.current;
          setIsRecording(false);
          setRecordingTime(0);
          recordingSecondsRef.current = 0;
          setIsSending(true);

          const localUrl = URL.createObjectURL(blob);
          localUrls.current.add(localUrl);
          pendingUploads.current += 1;
          const userMsg: Message = { id: `temp-${Date.now()}`, role: "user", content: t("chat.voiceMessage"), messageType: "voice", mediaUrl: localUrl, mediaDuration: duration, createdAt: new Date() };
          setMessages(prev => [...prev, userMsg]);
          const streamId = `stream-${Date.now()}`;
          setMessages(prev => [...prev, { id: streamId, role: "assistant", content: "", isStreaming: true, emotionalState: currentState }]);

          try {
            const result = await abortableMutation(
              "chat.sendVoice",
              {
                personaId,
                audioContent: base64,
                duration,
                fileName: `voice-${Date.now()}.webm`,
                // The language the persona answers in — see the image
                // path above.
                locale: locale === "en" ? "en" : "zh",
              },
              voiceController.signal,
            );
            /**
             * The voice note could not be read.
             *
             * The persona used to be given a placeholder as if the user
             * had said it, and answered it in character — warmly, as
             * though that were what the user had said. The user was
             * never told.
             */
            if (result.transcriptionFailed) {
              setMessages(prev => prev.filter(m => m.id !== streamId));
              toast.error(t("chat.voiceNotUnderstood"));
              return;
            }
            if (result.superseded || result.deferred) {
              setMessages((prev) => prev.filter((m) => m.id !== streamId));
              if (result.deferred) void utils.chat.pendingReply.invalidate({ personaId });
              return;
            }
            setMessages(prev => [...prev.map(m => {
              if (m.id === streamId) return { id: `ai-${Date.now()}`, role: "assistant" as const, content: result.reply, emotionalState: result.emotionalState, createdAt: new Date(), isStreaming: false };
              if (m === userMsg) return { ...m, content: result.transcription || t("chat.voiceMessage") };
              return m;
            }), ...extraBubbles((result as { extra?: ExtraMessage[] }).extra, result.emotionalState)]);
            setCurrentState(result.emotionalState);
            if (result.careNote?.showBanner) toast.info(careBannerText(result.careNote, t));
            if (result.crisis) setShowCrisis(true);
          } catch (err) {
            setMessages(prev => prev.filter(m => m.id !== streamId));
            if (voiceController.signal.aborted) {
              toast.info(t("chat.interrupted", { message: "" }));
            } else {
              toast.error(t("chat.voiceFailed", { message: (err as Error)?.message ?? "" }));
            }
          }
          finally {
            abortRef.current = null;
            // The upload is done — the server's copy of the recording
            // exists now, and the poll will bring it.
            pendingUploads.current = Math.max(0, pendingUploads.current - 1);
            setIsSending(false);
          }
        };
        reader.readAsDataURL(blob);
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setRecordingTime(0);
      recordingSecondsRef.current = 0;
      recordingTimerRef.current = setInterval(() => {
        recordingSecondsRef.current += 1;
        setRecordingTime(recordingSecondsRef.current);
      }, 1000);
    } catch { toast.error(t("chat.micDenied")); }
  }, [personaId, currentState, t, locale]);

  const stopRecording = useCallback(() => {
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    const recorder = mediaRecorderRef.current;
    // Stopping a recorder that is not recording throws.
    if (recorder && recorder.state === "recording") recorder.stop();
  }, []);

  const cancelRecording = useCallback(() => {
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.ondataavailable = null;
      mediaRecorderRef.current.onstop = null;
      /**
       * Only a recorder that is still recording is stopped.
       *
       * The cancel button used to call `stop()` on a recorder that had
       * already been stopped — the one the send button stops — and
       * that throws. So pressing "stop" and then "cancel" threw an
       * uncaught error.
       */
      if (mediaRecorderRef.current.state === "recording") {
        mediaRecorderRef.current.stop();
      }
      mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
    }
    setIsRecording(false);
    setRecordingTime(0);
    recordingSecondsRef.current = 0;
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // While an input method is composing, Enter is the key that picks
    // the candidate — not the key that sends. Sending on it meant that
    // typing Chinese sent the text half way through, which is the
    // primary way this app is used.
    const composing =
      (e.nativeEvent as unknown as { isComposing?: boolean }).isComposing ||
      e.keyCode === 229;
    if (e.key === "Enter" && !e.shiftKey && !composing) {
      e.preventDefault();
      handleSend();
    }
  };

  const mood = EMOTIONS[currentState as keyof typeof EMOTIONS] || EMOTIONS.warm;
  const moodRingStyle = { ["--mood-color" as string]: `var(${mood.cssVar})` };
  const starterQuestions: string[] = resolveStarterQuestions({
    sceneStarters: activeScene?.starters,
    personaStarters: (persona?.personaData as any)?.starterQuestions,
    fallback: Array.from(t("chat.defaultStarters")),
  });

  if (!hasPersonaId) return <NotFound />;

  /**
   * The persona could not be read.
   *
   * A deleted persona, or a link with an id that was edited by hand,
   * used to render an empty conversation with "..." as the name and no
   * explanation at all: the user could not tell whether their history
   * was gone or the app was broken.
   */
  /**
   * A persona that is not there, and a persona that could not be read.
   *
   * Every failure was rendered as a 404 — so a dropped connection or a
   * server having a bad minute showed "this page is not here" for a
   * persona that exists. The user was told their person was gone.
   */
  /**
   * A conversation that could not be read.
   *
   * The history is the whole conversation — so a failed request left
   * the user looking at an empty thread, with no message and no way to
   * try again. It looked exactly like a brand-new conversation.
   */
  if (historyFailed && !messages.length) {
    return (
      <div className="min-h-dvh w-full flex items-center justify-center bg-background px-4">
        <div className="max-w-md text-center space-y-4">
          <p className="text-sm text-foreground/85 leading-relaxed">{t("common.error")}</p>
          <Button variant="outline" className="rounded-md" onClick={() => refetchHistory()}>
            {t("common.retry")}
          </Button>
        </div>
      </div>
    );
  }

  if (personaFailed) {
    const status = (personaError as { data?: { code?: string } })?.data?.code;
    if (status === "NOT_FOUND") return <NotFound />;
    /**
     * A locked persona (C8.4) is not an error to retry.
     *
     * The generic panel offered a button that could only fail again;
     * the PIN is what opens it.
     */
    if (status === "PERSONA_LOCKED" || status === "LOCKED") {
      return <PersonaLockGate onUnlocked={() => { void refetchPersona(); }} />;
    }
    return (
      <div className="min-h-dvh w-full flex items-center justify-center bg-background px-4">
        <div className="max-w-md text-center space-y-4">
          <p className="text-sm text-foreground/85 leading-relaxed">{t("common.error")}</p>
          <Button variant="outline" className="rounded-md" onClick={() => refetchPersona()}>
            {t("common.retry")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="h-dvh bg-background flex flex-col relative chat-root"
      data-skin={skin.theme}
      data-night={nightMode ? "true" : undefined}
      style={
        skin.background
          ? {
              backgroundImage: `url("${skin.background}")`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }
          : undefined
      }
    >
      {/* The mailbox learns when this conversation is in front of the
          user (C8.2) — on mount, on return, and on each new message. */}
      <ReadMarker
        personaId={personaId}
        latestMessageId={messages.length > 0 ? messages[messages.length - 1]?.id : undefined}
      />
      {/* Header */}
      <header className="sticky top-0 z-40 app-header flex-shrink-0">
        <div className="container app-nav">
          <button onClick={() => navigate("/")} aria-label={t("common.back")}
            className="app-nav-back -ml-1">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            <div className="mood-ring-sm flex-shrink-0" style={moodRingStyle}>
              <PersonaAvatar name={persona?.name || "?"} url={persona?.avatarUrl} className="w-8 h-8 rounded-full text-sm" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                {/**
                    The page's heading.

                    The chat page has no `<h1>` — the name in the header
                    is what says what the page is, and the focus has to
                    land on it when the route changes. It says so
                    itself, so a screen reader announces it as the
                    heading and not as a stray line of text.
                    */}
                <p
                  className="app-nav-title truncate"
                  data-route-heading
                  role="heading"
                  aria-level={1}
                >
                  {displayName || "..."}
                </p>
                {/* The user should always know what they are talking to.
                    The label lives in the interface, not in the model's
                    discretion. */}
                <DigitalPersonaBadge compact />
                {/* The clock on their side. A person whose partner is
                    abroad needs to know it is the middle of the night
                    for them — the app had no way to say so. */}
                {theirClock && (
                  <span
                    className="text-[0.625rem] text-muted-subtle flex-shrink-0 hidden sm:inline"
                    title={t("chat.theirClockHint", { time: theirClock })}
                  >
                    {t("chat.theirClock", { time: theirClock })}
                  </span>
                )}
                {/* The next time they will be in the same place (C5.1). */}
                <MeetCountdown
                  personaId={personaId}
                  nextMeetAt={normalizePersonaSettings(persona?.settings).ldr?.nextMeetAt}
                  timezone={user?.timezone ?? persona?.timezone}
                />
                {/* Their own recordings are the first door for a memorial
                    persona (C7.3). */}
                <VoicesEntry
                  personaId={personaId}
                  name={displayName || t("common.them")}
                  memorial={memorialMode}
                />
                {/* How long it has been. */}
                {daysSinceTalk !== null && daysSinceTalk > 0 && (
                  <span
                    className="text-[0.625rem] text-muted-subtle flex-shrink-0 hidden sm:inline"
                    title={t("chat.lastContactHint", { days: daysSinceTalk })}
                  >
                    {t("chat.lastContact", { days: daysSinceTalk })}
                  </span>
                )}
                {intimacy && (
                  <span
                    className="text-xs flex-shrink-0"
                    title={t("chat.intimacyScore", {
                      level: t(`intimacy.${intimacy.level}` as any),
                      score: intimacy.score,
                    })}
                  >
                    {intimacy.icon}
                  </span>
                )}
                {activeScene && (
                  <span className="hidden md:inline-flex items-center max-w-[140px] truncate text-[11px] px-2 py-0.5 rounded-md border border-border text-muted-foreground">
                    {activeScene.icon} {activeScene.name}
                  </span>
                )}
              </div>
              {/* "TA" is a Chinese internet abbreviation. The dictionary
                  already has the right word for it. */}
              <p className="app-nav-subtitle truncate">{persona?.relationshipDesc || t("common.them")}</p>
              <ChatPeriodHint period={selectedPeriod} name={persona?.name || ""} />
              {/* The weather and the light where they are (C5.2). */}
              <TheirSide
                personaId={personaId}
                settings={persona?.settings}
                timezone={user?.timezone ?? null}
              />
            </div>
          </div>

          <div className="app-nav-actions">
            {/* 情感状态切换 */}
            <div className="relative">
              <button onClick={() => setShowStatePanel(!showStatePanel)}
                className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-md border text-xs font-medium transition-colors ${mood.chip}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${mood.dot}`} />
                <span className="hidden sm:inline">{t(mood.labelKey)}</span>
                <ChevronDown className={`w-3 h-3 transition-transform ${showStatePanel ? "rotate-180" : ""}`} />
              </button>
              {showStatePanel && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowStatePanel(false)} />
                  <motion.div
                    initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18, ease: "easeOut" as const }}
                    className="absolute right-0 top-full mt-2 z-50 w-60 surface p-1.5">
                    <p className="kicker px-2.5 pt-2 pb-1.5">{t("chat.switchState")}</p>
                    {EMOTION_KEYS.map((key) => {
                      const m = EMOTIONS[key];
                      return (
                      <button key={key} onClick={() => {
                        changeStateMutation.mutate({ id: personaId, emotionalState: key as any });
                        setCurrentState(key); setShowStatePanel(false);
                      }} className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-left transition-colors ${currentState === key ? "bg-muted" : "hover:bg-muted/60"}`}>
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${m.dot}`} />
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm text-foreground leading-tight">{t(m.labelKey)}</span>
                          <span className="block text-[11px] text-muted-foreground leading-tight mt-0.5 truncate">{t(m.descKey)}</span>
                        </span>
                        {currentState === key && <Check className="w-3.5 h-3.5 text-foreground flex-shrink-0" />}
                      </button>
                      );
                    })}
                  </motion.div>
                </>
              )}
            </div>

            {/* The portrait the app has built. A person who cannot see
                what the system thinks of their ex has no way of knowing
                whether to trust it. */}
            <button onClick={() => navigate(`/persona/${personaId}/profile`)} title={t("profile.kicker")} aria-label={t("profile.kicker")}
              className="app-nav-icon">
              <UserRound className="w-4 h-4" />
            </button>
            <button onClick={() => setShowScenePanel(!showScenePanel)} title={t("chat.sceneMode")} aria-label={t("chat.sceneMode")}
              className={`app-nav-icon ${activeScene || showScenePanel ? "app-nav-icon-active" : ""}`}>
              <Theater className="w-4 h-4" />
            </button>
            <div className="relative">
              <button onClick={() => setShowMenu(!showMenu)} aria-label={t("chat.moreActions")}
                className="app-nav-icon">
                <MoreVertical className="w-4 h-4" />
              </button>
              {showMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
                  <motion.div
                    initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16, ease: "easeOut" as const }}
                    className="absolute right-0 top-full mt-2 z-50 surface p-1.5 min-w-[168px]">
                    <button onClick={() => { setShowSearch(true); setShowMenu(false); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-foreground hover:bg-muted/60 rounded-md transition-colors">
                      <Search className="w-4 h-4 text-muted-foreground" />{t("chat.search")}
                    </button>
                    <button onClick={() => { toggleProvenance(); setShowMenu(false); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-foreground hover:bg-muted/60 rounded-md transition-colors text-left">
                      <Quote className="w-4 h-4 text-muted-foreground" />
                      {t("chat.provenanceToggle", { name: displayName || t("common.them") })}
                    </button>
                    <button onClick={() => { setShowMarks(true); setShowMenu(false); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-foreground hover:bg-muted/60 rounded-md transition-colors text-left">
                      <Star className="w-4 h-4 text-muted-foreground" />{t("chat.marksEntry")}
                    </button>
                    <button onClick={() => { setShowTimeline(true); setShowMenu(false); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-foreground hover:bg-muted/60 rounded-md transition-colors">
                      <Clock className="w-4 h-4 text-muted-foreground" />{t("chat.memoryTimeline")}
                    </button>
                    <button onClick={() => { setShowEmotionReport(true); setShowMenu(false); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-foreground hover:bg-muted/60 rounded-md transition-colors">
                      <BarChart3 className="w-4 h-4 text-muted-foreground" />{t("chat.emotionReport")}
                    </button>
                    <OutboundEntry
                      personaId={personaId}
                      name={displayName || t("common.them")}
                      memorial={memorialMode}
                      onOpen={() => { setShowOutbound(true); setShowMenu(false); }}
                    />
                    <button onClick={() => { setShowWaitGauge(true); setShowMenu(false); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-foreground hover:bg-muted/60 rounded-md transition-colors text-left">
                      <Clock className="w-4 h-4 text-muted-foreground" />
                      {t("waitGauge.title", { name: displayName || t("common.them") })}
                    </button>
                    <button onClick={() => { setShowScheduled(true); setShowMenu(false); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-foreground hover:bg-muted/60 rounded-md transition-colors text-left">
                      <CalendarClock className="w-4 h-4 text-muted-foreground" />
                      {t("chat.scheduledSend")}
                    </button>
                    <button onClick={() => { navigate(`/persona/${personaId}/decode`); setShowMenu(false); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-foreground hover:bg-muted/60 rounded-md transition-colors text-left">
                      <Search className="w-4 h-4 text-muted-foreground" />
                      {t("decode.title")}
                    </button>
                    {chatState.ok && (
                      <button onClick={() => { navigate(`/persona/${personaId}/rehearsal`); setShowMenu(false); }}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-foreground hover:bg-muted/60 rounded-md transition-colors text-left">
                        <Theater className="w-4 h-4 text-muted-foreground" />
                        {t("rehearsal.title")}
                      </button>
                    )}
                    <button onClick={() => { navigate(`/persona/${personaId}/roleplay`); setShowMenu(false); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-foreground hover:bg-muted/60 rounded-md transition-colors text-left">
                      <UserRound className="w-4 h-4 text-muted-foreground" />
                      {t("roleplay.title")}
                    </button>
                    <button onClick={() => { navigate(`/diary`); setShowMenu(false); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-foreground hover:bg-muted/60 rounded-md transition-colors">
                      <BookOpen className="w-4 h-4 text-muted-foreground" />{t("diary.title")}
                    </button>
                    <button onClick={() => { handleExport(); setShowMenu(false); }} disabled={exportMutation.isPending}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-foreground hover:bg-muted/60 rounded-md transition-colors disabled:opacity-50">
                      <Download className="w-4 h-4 text-muted-foreground" />{t("chat.export")}
                    </button>
                    {/* Starting a farewell is the user's own move. It is
                        hidden when the graduation mode is off, because then
                        the mechanism is not available at all. */}
                    {graduationMode !== "off" && (
                      <button onClick={() => { setShowManualGraduation(true); setShowMenu(false); }}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-foreground hover:bg-muted/60 rounded-md transition-colors">
                        <HeartCrack className="w-4 h-4 text-muted-foreground" />{t("graduation.manualMoment")}
                      </button>
                    )}
                    {/* Clearing the conversation is a single click that
                        deletes the whole transcript, for good. The page
                        asks before it deletes a scene; this one did not. */}
                    <button onClick={async () => {
                      const yes = await confirm({ description: t("chat.clearConfirm") });
                      if (!yes) return;
                      clearMutation.mutate({ personaId });
                    }}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-destructive hover:bg-destructive/10 rounded-md transition-colors">
                      <Trash2 className="w-4 h-4" />{t("chat.clear")}
                    </button>
                  </motion.div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* The stars and topics of this conversation (C8.10). */}
        <MarksPanel
          open={showMarks}
          marks={markList}
          onClose={() => setShowMarks(false)}
          onJump={(messageId) => { setShowMarks(false); jumpToMessage(messageId); }}
          onRemove={(id) => removeMark.mutate({ id })}
        />

        {/* Naming a point in the conversation to return to (C8.10). */}
        {topicTarget && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setTopicTarget(null)} />
            <div
              role="dialog"
              aria-label={t("chat.topicPrompt")}
              className="fixed left-1/2 top-1/3 z-50 w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 surface p-4 space-y-3"
            >
              <p className="text-sm font-medium text-foreground">{t("chat.topicPrompt")}</p>
              <input
                aria-label={t("chat.topicPrompt")}
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm"
                maxLength={60}
                value={topicName}
                autoFocus
                onChange={(event) => setTopicName(event.target.value.slice(0, 60))}
                onKeyDown={(event) => {
                  if (event.key === "Enter") saveTopic();
                  if (event.key === "Escape") setTopicTarget(null);
                }}
              />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" className="rounded-md" onClick={() => setTopicTarget(null)}>
                  {t("chat.topicCancel")}
                </Button>
                <Button size="sm" className="rounded-md" onClick={saveTopic} disabled={!topicName.trim()}>
                  {t("chat.topicSave")}
                </Button>
              </div>
            </div>
          </>
        )}

        {showScenePanel && (
          <ScenePanel
            personaId={personaId}
            activeSceneId={persona?.activeSceneId ?? null}
            onClose={() => setShowScenePanel(false)}
            onPersonaChanged={refetchPersona}
          />
        )}
      </header>

      <MeetDayNote
        personaId={personaId}
        name={displayName || t("common.them")}
        nextMeetAt={normalizePersonaSettings(persona?.settings).ldr?.nextMeetAt}
        timezone={persona?.timezone || user?.timezone}
      />

      {/* Asked once, the next time the chat is opened after the day (C5.1). */}
      <MeetCountdown
        personaId={personaId}
        nextMeetAt={normalizePersonaSettings(persona?.settings).ldr?.nextMeetAt}
        timezone={user?.timezone ?? persona?.timezone}
        mode="banner"
      />

      {/* The days a record-range scene is set in (C8.13). */}
      <SceneRangeBanner
        scene={activeScene}
        personaId={personaId}
        personaName={displayName || t("common.them")}
      />

      {showSearch && (
        <SearchPanel
          personaId={personaId}
          onClose={() => setShowSearch(false)}
          onJumpTo={jumpToMessage}
        />
      )}

      <OutboundDrawer
        personaId={personaId}
        name={displayName || t("common.them")}
        open={showOutbound}
        onClose={() => setShowOutbound(false)}
      />

      {showWaitGauge && (
        <div
          className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-4"
          onClick={() => setShowWaitGauge(false)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("waitGauge.title", { name: displayName || t("common.them") })}
            className="surface relative w-full max-w-md max-h-[80vh] overflow-y-auto p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setShowWaitGauge(false)}
              aria-label={t("common.close")}
              className="absolute right-3 top-3 text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </button>
            <WaitGauge personaId={personaId} name={displayName || t("common.them")} timezone={persona?.timezone || user?.timezone} />
          </div>
        </div>
      )}

      <ScheduledSend
        personaId={personaId}
        name={displayName || t("common.them")}
        open={showScheduled}
        onClose={() => setShowScheduled(false)}
      />

      {showCrisis && <CrisisCard onClose={() => setShowCrisis(false)} />}

      {/* The notes the user kept for later, surfaced when they come
          back. They were written for this moment, so they belong here
          rather than in a list nobody opens. */}
      {waitingNotes.length > 0 && !dismissedNotes && (
        <div className="container max-w-2xl mx-auto mb-4">
          <div className="rounded-xl border border-border/70 bg-muted/30 p-4 relative">
            <p className="text-xs font-medium text-foreground/80 mb-2">
              {t("letters.todoTitle", {
                name: displayName || t("common.them"),
                open: waitingNotes.filter((note: any) => !note.doneAt).length,
              })}
            </p>
            <ul className="space-y-1.5">
              {waitingNotes.map((note: any) => (
                <li key={note.id} className="text-xs text-muted-foreground leading-relaxed">
                  · {note.body}
                </li>
              ))}
            </ul>
            <button
              onClick={() => setDismissedNotes(true)}
              aria-label={t("common.close")}
              className="absolute top-2.5 right-2.5 text-muted-subtle hover:text-foreground transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      <AfterChat personaId={personaId} name={displayName || t("common.them")} />

      {/* Messages */}
      {/**
       * The list is a log.
       *
       * A screen reader is told nothing when the reply arrives, when it
       * starts streaming, or when the crisis card appears — so a person
       * who cannot see the screen had no way of knowing that their
       * person had answered.
       */}
      {/* The few kept in front of the conversation (C8.10). */}
      <PinnedBand
        marks={markList.filter((mark) => mark.kind === "pin")}
        onJump={jumpToMessage}
        onUnpin={(id) => removeMark.mutate({ id })}
      />
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto"
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        aria-label={t("chat.conversation", { name: persona?.name || t("common.them") })}
      >
        <div className="container py-4 sm:py-6 max-w-2xl mx-auto">
          {messages.length === 0 && (
            <motion.div
              initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: "easeOut" as const }}
              className="text-center py-12 sm:py-16">
              <div className="mood-ring-sm inline-flex" style={moodRingStyle}>
                <PersonaAvatar name={persona?.name || "?"} url={persona?.avatarUrl} className="w-16 h-16 sm:w-20 sm:h-20 rounded-full text-2xl sm:text-3xl" />
              </div>
              <h2 className="page-title mt-7">
                {t("chat.waitingForYou", { name: persona?.name || t("common.them") })}
              </h2>
              <p className="text-muted-foreground text-sm mt-2.5">{t(mood.descKey)}</p>
              <hr className="rule w-16 mx-auto my-8" />
              <div className="flex flex-wrap gap-2 justify-center max-w-md mx-auto">
                {starterQuestions.map((q: string) => (
                  <button key={q} onClick={() => setInput(q)}
                    className="text-xs px-3.5 py-2 rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors">
                    {q}
                  </button>
                ))}
              </div>
              <button onClick={() => setShowScenePanel(true)}
                className="mt-6 inline-flex items-center gap-2 text-xs px-4 py-2 rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors">
                <Theater className="w-3.5 h-3.5" />
                {t("chat.pickScene")}
              </button>
            </motion.div>
          )}
          {/**
           * The button is not shown once the conversation has been
           * walked back to its beginning.
           *
           * It used to stay on the screen — disabled, doing nothing —
           * for every conversation of fifty messages or more.
           */}
          {messages.length > 0 && hasOlder && (
            <div className="flex justify-center pb-3">
              <button
                type="button"
                onClick={loadOlderMessages}
                disabled={loadingOlder}
                className="text-xs px-3.5 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
              >
                {loadingOlder ? t("chat.loadingOlder") : t("chat.loadOlder")}
              </button>
            </div>
          )}
          {/* What the underlines mean (C10.7). It is only shown while
              they are on — the legend explains a claim the page is
              actually making. */}
          {provenanceOn && (
            <p className="text-[11px] text-muted-subtle text-center px-4 pb-2">
              {t("chat.provenanceLegend", { name: displayName || t("common.them") })}
            </p>
          )}
          {(() => {
            // The mood of the last message that had one, as the list is
            // walked. It is what the chip is compared against.
            let lastMoodBefore: string | undefined;
            return messages.map((msg, i) => {
            // The mood chip is a signal, not decoration — showing it on every
            // message turns the conversation into a wall of labels. It only
            // appears when the mood actually shifts.
            //
            // The last mood before this message is carried along as the
            // list is walked. It used to be found by copying and
            // reversing the whole list for every message — so a long
            // conversation was walked once per message.
            const prevMood = lastMoodBefore;
            if (msg.role === "assistant" && msg.emotionalState) {
              lastMoodBefore = msg.emotionalState;
            }
            const showMood = Boolean(
              msg.role === "assistant" &&
              msg.emotionalState &&
              msg.emotionalState !== prevMood,
            );
            const numericId = typeof msg.id === "number" ? msg.id : Number(msg.id);
            const offer =
              msg.role === "user" && msg.pendingChoice
                ? { options: msg.pendingChoice.options, replyToMessageId: numericId }
                : msg.role === "user" && liveChoice && liveChoice.replyToMessageId === numericId
                  ? liveChoice
                  : null;
            const previous = i > 0 ? messages[i - 1] : undefined;
            return (
              <div key={msg.id} data-message-id={msg.id}>
              <TimeBar
                at={msg.createdAt}
                previousAt={previous?.createdAt}
                skin={skin.theme}
                locale={locale}
                timeZone={user?.timezone}
              />
              <MessageBubble
                msg={msg}
                personaName={displayName || "?"}
                showUserAvatar={skin.theme !== "classic"}
                userName={user?.name || t("common.me")}
                showMood={showMood}
                personaId={personaId}
                night={nightMode}
                provenanceOn={provenanceOn}
                onRegenerate={handleRegenerate}
                onEdit={handleEditMessage}
                onDelete={handleDeleteMessage}
                deleting={deleteMessageMutation.isPending}
                onQuote={handleQuote}
                onCollectOutbound={handleCollectOutbound}
                onStar={(row) => toggleMark(row, "star")}
                onPin={(row) => toggleMark(row, "pin")}
                onTopic={startTopic}
                starred={Boolean(markOf(numericId, "star"))}
                pinned={Boolean(markOf(numericId, "pin"))}
              />
              {offer && Number.isInteger(offer.replyToMessageId) && (
                <div className="mt-2">
                  <ChoiceBubble
                    personaId={personaId}
                    personaName={persona?.name || "?"}
                    replyToMessageId={offer.replyToMessageId}
                    options={offer.options}
                    onPicked={(picked) => {
                      setLiveChoice(null);
                      setMessages((prev) => [
                        ...prev.map((row) =>
                          row.id === msg.id ? { ...row, pendingChoice: null } : row,
                        ),
                        {
                          id: `ai-${picked.messageId}`,
                          role: "assistant",
                          content: picked.content,
                          emotionalState: picked.emotionalState,
                          createdAt: new Date(),
                        },
                      ]);
                      setCurrentState(picked.emotionalState);
                    }}
                  />
                </div>
              )}
              </div>
            );
            });
          })()}
          <PendingReply
            personaId={personaId}
            name={persona?.name || "?"}
            onArrived={() => { void refetchHistory(); }}
          />
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="flex-shrink-0 chat-composer">
        <div className="container pt-3 max-w-2xl mx-auto">
          {/**
           * A persona that has said goodbye.
           *
           * The notice that comes back from a sleeping persona says "if
           * you still want to talk, awaken it first" — and the only
           * control for that was on the lobby card, folded away behind a
           * "show graduated" toggle. So the person was told to do
           * something they could not do from where they were.
           */}
          {/* The lines brought in from the record (C8.10). */}
          {quotedRecords.length > 0 && (
            <div className="mb-2 rounded-md border-l-2 border-primary/40 bg-muted/40 px-2.5 py-1.5">
              <div className="flex items-center gap-2">
                <p className="flex-1 text-xs text-muted-foreground">
                  {String(t("chat.quotedRecords", {
                    date: quotedRecords[0]?.timestamp
                      ? formatInstantInZone(quotedRecords[0].timestamp, locale, user?.timezone)
                      : "",
                    n: quotedRecords.length,
                  }))}
                </p>
                <button
                  type="button"
                  onClick={removeQuote}
                  aria-label={t("chat.removeQuote")}
                  className="text-muted-subtle hover:text-foreground"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
          {/* The month's ceiling, said where the spending happens (C8.9). */}
          <BudgetNotice />
          {persona?.graduationStatus === "graduated" && (
            <div className="mb-3 rounded-lg border border-border bg-muted/40 px-3.5 py-3 flex items-center gap-3 flex-wrap">
              <p className="text-xs text-muted-foreground leading-relaxed flex-1 min-w-[12rem]">
                {t("lobby.card.graduatedNotice", { name: persona?.name || "" })}
              </p>
              <Button size="sm" className="rounded-md px-4 flex-shrink-0"
                disabled={awakenMutation.isPending}
                onClick={() => awakenMutation.mutate({ id: personaId })}>
                {awakenMutation.isPending ? t("common.saving") : t("lobby.card.awaken")}
              </Button>
            </div>
          )}
          {isRecording ? (
            <div className="flex items-center gap-3 h-11">
              <button onClick={cancelRecording} aria-label={t("chat.cancelRecording")}
                className="w-10 h-10 rounded-md flex items-center justify-center text-destructive hover:bg-destructive/10 border border-transparent hover:border-destructive/20 transition-colors flex-shrink-0">
                <X className="w-5 h-5" />
              </button>
              <div className="flex-1 flex items-center gap-2.5 min-w-0">
                <span className="w-2 h-2 rounded-full bg-destructive breathing-dot flex-shrink-0" />
                <span className="text-sm text-foreground whitespace-nowrap">{t("chat.recordingNow", { seconds: recordingTime })}</span>
                <div className="flex-1 flex items-center gap-0.5 px-2 overflow-hidden">
                  {recordingBarHeights.map((h, i) => (
                    <div key={i} className="w-1 rounded-full bg-primary/40 animate-pulse flex-shrink-0"
                      style={{ height: `${h}px`, animationDelay: `${i * 0.08}s` }} />
                  ))}
                </div>
              </div>
              <Button onClick={stopRecording} aria-label={t("chat.sendVoice")}
                className="h-11 w-11 p-0 rounded-md flex-shrink-0">
                <Send className="w-5 h-5" />
              </Button>
            </div>
          ) : !chatState.ok ? (
            // The user's own step-down, kept in one component (C6.1).
            <ClosedComposer
              personaId={personaId}
              name={displayName || t("common.them")}
              reason={chatState.reason}
              onRefetch={() => refetchPersona()}
              onOpenProfile={() => navigate(`/persona/${personaId}/profile`)}
            />
          ) : (
            /*
             * The notices are a row of their own.
             *
             * The "replying to…" strip and the "it is the middle of the
             * night where they are" notice were flex siblings of the
             * textarea — so they took their content width out of the
             * row, and the textarea was squeezed to a few characters.
             * On a 375-pixel phone the input was two or three characters
             * wide, exactly at the hours when a partner abroad is
             * asleep — which is a normal evening for the user.
             */
            <>
            <div className="space-y-1.5 mb-1.5">
              {/* The message being replied to. */}
              {replyTo && (
                <div className="flex items-center gap-2 rounded-md border-l-2 border-primary/40 bg-muted/40 px-2.5 py-1.5">
                  <CornerUpLeft className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                  <span className="text-xs text-muted-foreground line-clamp-1 flex-1 min-w-0">
                    {replyTo.content}
                  </span>
                  <button
                    onClick={() => setReplyTo(null)}
                    aria-label={t("common.cancel")}
                    className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}
              {/* It is the middle of the night where they are. Saying so
                  is the whole difference between a message that lands and
                  one that does not. */}
              {theyAreAsleep && (
                <p className="text-[0.625rem] text-muted-subtle flex items-center gap-1">
                  <Moon className="w-3 h-3" /> {t("chat.theyAreAsleep")}
                </p>
              )}
              {periods.length > 1 && (
                <div className="flex items-center gap-2">
                  <Label htmlFor="chat-period" className="text-[0.625rem] text-muted-subtle">{t("chat.period")}</Label>
                  <select
                    id="chat-period"
                    value={periodId}
                    onChange={(e) => setPeriodId(e.target.value)}
                    className="h-7 rounded-md border border-input bg-card px-2 text-xs"
                  >
                    <option value="">{t("chat.periodCurrent")}</option>
                    {periods.map((period) => (
                      <option key={period.id} value={period.id}>
                        {period.from} – {period.to}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <div className="flex gap-2 items-end">
              <div className="relative flex-shrink-0">
                <button onClick={() => setShowAttach(!showAttach)} aria-label={t("chat.attach")}
                  className={`h-11 w-11 flex items-center justify-center rounded-md border transition-colors ${showAttach ? "text-foreground bg-muted border-border" : "text-muted-foreground hover:text-foreground hover:bg-muted border-transparent"}`}>
                  <Plus className={`w-5 h-5 transition-transform ${showAttach ? "rotate-45" : ""}`} />
                </button>
                {showAttach && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowAttach(false)} />
                    <motion.div
                      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16, ease: "easeOut" as const }}
                      className="absolute bottom-full left-0 mb-2 z-50 surface p-1.5 min-w-[150px]">
                      <label className="flex items-center gap-2.5 px-3 py-2.5 text-sm text-foreground hover:bg-muted/60 rounded-md transition-colors cursor-pointer">
                        <Image className="w-4 h-4 text-muted-foreground" />{t("chat.attachImage")}
                        <input type="file" accept="image/*" className="hidden" onChange={handleImageSelect} />
                      </label>
                      <button onClick={() => { setShowAttach(false); startRecording(); }}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-foreground hover:bg-muted/60 rounded-md transition-colors">
                        <Mic className="w-4 h-4 text-muted-foreground" />{t("chat.voiceMessageAction")}
                      </button>
                    </motion.div>
                  </>
                )}
              </div>
              {/**
               * The composer is named.
               *
               * It had a placeholder and nothing else, so a screen
               * reader announced it as "edit text".
               */}
              <Label className="sr-only" htmlFor="chat-composer">{t("chat.placeholder", { name: persona?.name || t("common.them") })}</Label>
              <Textarea id="chat-composer" ref={textareaRef} value={input} onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown} placeholder={t("chat.placeholder", { name: persona?.name || t("common.them") })}
                /**
                 * The length the server accepts.
                 *
                 * There was no limit here — so a message of two thousand
                 * and one characters was refused with "that request was
                 * not complete", which says nothing about the length,
                 * and the text was lost with it.
                 */
                maxLength={2000}
                rows={1} className="flex-1 min-w-0 resize-none bg-muted/40 border-border text-foreground placeholder:text-muted-subtle rounded-md min-h-[44px] max-h-32 px-4 py-3" />
              {isSending && (
                <Button onClick={handleStopStreaming} aria-label={t("chat.stop")}
                  className="h-11 w-11 p-0 rounded-md flex-shrink-0">
                  <X className="w-5 h-5" />
                </Button>
              )}
              <Button onClick={handleSend} disabled={!input.trim() || !isOnline} aria-label={t("chat.send")}
                className="h-11 w-11 p-0 rounded-md flex-shrink-0">
                <Send className="w-5 h-5" />
              </Button>
            </div>
            </>
          )}
          <p className="hidden sm:block text-muted-subtle text-[10px] mt-1.5 text-right tracking-wide">
            {t("chat.enterToSend")}
          </p>
        </div>
      </div>

      {showTimeline && <MemoryTimeline personaId={personaId} onClose={() => setShowTimeline(false)} onJumpTo={jumpToMessage} />}
      {showEmotionReport && <EmotionReport personaId={personaId} personaName={persona?.name || "?"} onClose={() => setShowEmotionReport(false)} />}
      <GraduationModal personaId={personaId} personaName={persona?.name || "?"} open={showGraduation} onClose={() => setShowGraduation(false)} />
      <GraduationModal personaId={personaId} personaName={persona?.name || "?"} open={showManualGraduation}
        variant="manual" onClose={() => setShowManualGraduation(false)} />

      {undo.node}
    </div>
  );
}

// ─── SEARCH PANEL ────────────────────────────────────────────────────────────

/**
 * The server's id for a message on the screen.
 *
 * A message that has just been written is on the screen with a local
 * id — "ai-412" or "temp-173…" — until the next poll replaces it with
 * the number the server gave it. The reply-to was only sent for the
 * numeric ones, so replying to a message that was still local sent
 * nothing: the persona answered the message before it instead.
 */
function serverMessageId(id: string | number | undefined): number | undefined {
  if (typeof id === "number") return id;
  if (typeof id !== "string") return undefined;
  const digits = /^ai-(\d+)$/.exec(id);
  if (digits) return Number(digits[1]);
  return undefined;
}

/**
 * The index of the user's own question before a message.
 *
 * `findLastIndex` is not in every browser — and where it is missing,
 * the optional call returned nothing, so the cut landed on the answer
 * itself and the user's question was replaced by it.
 */
function lastUserMessageIndex(messages: Message[], before: number): number {
  for (let i = Math.min(before, messages.length) - 1; i >= 0; i--) {
    if (messages[i].role === "user") return i;
  }
  return -1;
}

function SearchPanel({
  personaId,
  onClose,
  onJumpTo,
}: {
  personaId: number;
  onClose: () => void;
  /** Scrolls to a message and highlights it. */
  onJumpTo?: (messageId: number) => void;
}) {
  const { t, locale } = useLocale();
  /**
   * The user's own clock.
   *
   * The times in the search results were the browser's — so a result
   * found by its content carried a time from another calendar than
   * the one the messages around it are in.
   */
  const { user } = useAuth();
  const timezone = (user as any)?.timezone ?? null;
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The panel is closed by the unmount as often as by the button, and a
  // timer that fires afterwards sets state on a component that is gone
  // and starts a query for a panel that is not there.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const { data: results } = trpc.chat.search.useQuery(
    { personaId, query: debouncedQuery },
    { enabled: debouncedQuery.length > 0 }
  );

  const handleChange = (val: string) => {
    setQuery(val);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setDebouncedQuery(val.trim()), 300);
  };

  const highlight = (text: string, q: string) => {
    if (!q) return text;
    const parts = text.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
    return parts.map((part, i) =>
      part.toLowerCase() === q.toLowerCase()
        ? <mark key={i} className="bg-cinnabar/20 text-foreground rounded-sm px-0.5">{part}</mark>
        : part
    );
  };

  return (
    <div className="bg-background border-b border-border animate-fade-in">
      <div className="container max-w-2xl mx-auto py-3">
        <div className="flex items-center gap-2.5 px-3 py-2 rounded-md border border-border bg-muted/40">
          <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <Label className="sr-only" htmlFor="chat-search">{t("chat.searchPlaceholder")}</Label>
          <input id="chat-search" value={query} onChange={e => handleChange(e.target.value)} autoFocus
            placeholder={t("chat.searchPlaceholder")} className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-subtle outline-none" />
          <button onClick={onClose} aria-label={t("chat.closeSearch")} className="text-muted-foreground hover:text-foreground transition-colors"><X className="w-4 h-4" /></button>
        </div>
        {debouncedQuery && results && (
          <div className="mt-3 max-h-64 overflow-y-auto space-y-1.5">
            {results.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">{t("chat.noResults")}</p>
            ) : (
              results.map((m: any) => (
                /**
                 * A button, not a div with a click handler.
                 *
                 * The search exists so somebody can find what they said
                 * six months ago — and it could not be opened with the
                 * keyboard at all.
                 */
                <button key={m.id} type="button"
                  className="w-full text-left flex items-start gap-2 px-2.5 py-2 rounded-md hover:bg-muted/50 transition-colors cursor-pointer"
                  onClick={() => { onJumpTo?.(m.id); onClose(); }}>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-sm flex-shrink-0 mt-0.5 ${m.role === "user" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                    {m.role === "user" ? t("common.me") : t("common.them")}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground line-clamp-2">{highlight(m.content, debouncedQuery)}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {formatInstantInZone(m.createdAt, locale, timezone)} {formatTimeInZone(m.createdAt, locale, timezone)}
                    </p>
                  </div>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── MEMORY TIMELINE ─────────────────────────────────────────────────────────

function MemoryTimeline({ personaId, onClose, onJumpTo }: { personaId: number; onClose: () => void; onJumpTo?: (messageId: number) => void }) {
  const { t } = useLocale();
  const { data: memories, refetch, isError: memoriesFailed, isLoading: memoriesLoading } =
    trpc.memory.list.useQuery({ personaId });
  const memoryItems = memories?.items ?? [];
  /**
   * The three writes say what happened.
   *
   * They had no `onError`, so a rejected write left the row unchanged
   * with no message at all: the user believed they had saved a memory,
   * or removed a pinned one, and the pinned memory — which is injected
   * into every prompt — was still there.
   */
  const createMutation = trpc.memory.create.useMutation({
    onSuccess: () => { refetch(); setShowAdd(false); },
    onError: (e: any) => toast.error(e.message),
  });
  const extractMutation = trpc.memory.autoExtract.useMutation({
    onSuccess: (data) => {
      refetch();
      /**
       * What happened, said plainly.
       *
       * "Extracted 0 memories" said nothing about *why* — and the
       * reasons are very different: the conversation held nothing new,
       * the model answered with something that could not be read, or
       * everything in it was already remembered.
       */
      if (data.extracted.length > 0) {
        toast.success(t("chat.memory.extracted", { count: data.extracted.length }));
      } else if (data.running) {
        /**
         * Another extraction is running.
         *
         * The panel said "no new memories were found" — which is a
         * claim about the conversation, and nothing had been looked at.
         */
        toast.info(t("chat.memory.extractedRunning"));
      } else if (data.readable === false) {
        toast.error(t("chat.memory.extractedUnreadable"));
      } else if (data.skipped > 0) {
        toast.info(t("chat.memory.extractedKnown", { count: data.skipped }));
      } else {
        toast.info(t("chat.memory.extractedNone"));
      }
    },
    onError: (e: any) => toast.error(e.message),
  });

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", category: "memory" as "memory" | "milestone" | "anniversary" | "anchor", date: "" });

  /**
   * The window.
   *
   * It looks modal, so it is one: the focus goes into it, Tab stays
   * inside it, Escape closes it, and the focus comes back.
   */
  const dialogRef = useDialogFocus<HTMLDivElement>(true, onClose);

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={t("chat.memoryTimeline")}
        className="relative ml-auto w-full max-w-sm bg-card border-l border-border h-full flex flex-col animate-slide-in-right">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="font-display font-semibold text-foreground">{t("chat.memoryTimeline")}</h3>
          <div className="flex items-center gap-2">
            <button onClick={() => extractMutation.mutate({ personaId })} disabled={extractMutation.isPending}
              className="text-xs px-3 py-1.5 rounded-md border border-cinnabar/30 text-cinnabar hover:bg-cinnabar/5 transition-colors disabled:opacity-50">
              {extractMutation.isPending ? t("chat.memory.extracting") : t("chat.memory.extract")}
            </button>
            <button onClick={onClose} aria-label={t("common.close")} className="app-nav-icon !h-8 !min-w-8"><X className="w-4 h-4" /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {/**
           * A failure is not an empty list.
           *
           * The request failed, so the list was empty, and the panel
           * said "you have no memories" — which is a claim about the
           * user's own data, and it was false. The user then added the
           * memories they already had.
           */}
          {memoriesFailed && (
            <div className="text-center py-12 text-muted-foreground text-sm">
              <p>{t("common.error")}</p>
              <button
                type="button"
                onClick={() => refetch()}
                className="mt-2 text-xs underline underline-offset-2 hover:text-foreground"
              >
                {t("common.retry")}
              </button>
            </div>
          )}
          {!memoriesFailed && !memoriesLoading && memoryItems.length === 0 && !showAdd && (
            <div className="text-center py-12 text-muted-foreground text-sm">
              <Clock className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p>{t("chat.memory.empty")}</p>
              <p className="text-xs mt-1">{t("chat.memory.emptyHint")}</p>
            </div>
          )}

          {(memories?.total ?? 0) > memoryItems.length && (
            <p className="text-xs text-muted-foreground mb-3">
              {t("chat.memory.capped", { shown: memoryItems.length, total: memories?.total ?? 0 })}
            </p>
          )}
          <MemoryReview
            personaId={personaId}
            items={memoryItems}
            onJumpTo={onJumpTo}
            onChanged={() => refetch()}
            onClose={onClose}
          />

          {showAdd && (
            <div className="mt-4 p-3.5 bg-muted/40 rounded-md border border-border space-y-2">
              <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder={t("chat.memory.titlePlaceholder")} className="w-full text-sm bg-transparent border-b border-border pb-1.5 text-foreground placeholder:text-muted-subtle outline-none" />
              <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder={t("chat.memory.descriptionPlaceholder")} rows={2} className="w-full text-xs bg-transparent border-b border-border pb-1.5 text-foreground placeholder:text-muted-subtle outline-none resize-none" />
              <div className="flex gap-2">
                <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value as "memory" | "milestone" | "anniversary" | "anchor" }))}
                  className="text-xs bg-muted border border-border rounded-md px-2 py-1.5 text-foreground">
                  <option value="memory">{t("chat.memory.categories.memory")}</option>
                  <option value="milestone">{t("chat.memory.categories.milestone")}</option>
                  <option value="anniversary">{t("chat.memory.categories.anniversary")}</option>
                  <option value="anchor">{t("chat.memory.categories.anchor")}</option>
                </select>
                <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                  className="text-xs bg-muted border border-border rounded-md px-2 py-1.5 text-foreground" />
              </div>
              <div className="flex gap-2 justify-end pt-1">
                <button onClick={() => setShowAdd(false)} className="text-xs px-3 py-1.5 text-muted-foreground hover:text-foreground transition-colors">{t("common.cancel")}</button>
                <button onClick={() => { if (form.title.trim()) createMutation.mutate({ personaId, ...form }); }}
                  disabled={!form.title.trim() || createMutation.isPending}
                  className="text-xs px-3.5 py-1.5 rounded-md bg-primary text-primary-foreground disabled:opacity-50">{t("common.save")}</button>
              </div>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-border">
          <button onClick={() => { setShowAdd(true); setForm({ title: "", description: "", category: "memory", date: "" }); }}
            className="w-full flex items-center justify-center gap-1.5 text-sm py-2.5 bg-muted hover:bg-muted/80 text-foreground rounded-md transition-colors">
            <Plus className="w-4 h-4" />{t("chat.memory.add")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── EMOTION REPORT ──────────────────────────────────────────────────────────

/**
 * The emotion report.
 *
 * Exported so its behaviour can be tested: the panel is the one place
 * that says how many days the user talked to their persona, and it is
 * inside a page that is far too large to render in a test.
 */
export function EmotionReport({ personaId, personaName, onClose }: { personaId: number; personaName: string; onClose: () => void }) {
  const { t, locale } = useLocale();
  const [days, setDays] = useState(30);
  const { data: report, isError: reportFailed, isLoading: reportLoading } =
    trpc.emotion.getReport.useQuery({ personaId, days });

  // The bar's height is the number of messages that day — a quantity —
  // and its colour is the mood. The height used to be the mood's
  // position in an arbitrary list, so a day with one message and a day
  // with thirty drew the same bar.
  const snapshots = report?.snapshots || [];
  const busiest = Math.max(1, ...snapshots.map((s: any) => Number(s.messageCount) || 0));
  const chartData = snapshots.map((s: any) => ({
    date: s.date,
    value: Number(s.messageCount) || 0,
    state: s.emotionalState,
    label: emotionOf(s.emotionalState) ? t(emotionOf(s.emotionalState)!.labelKey) : s.emotionalState,
    messages: s.messageCount,
  }));

  const pieData = (report?.distribution || []).map((d: any) => ({
    name: emotionOf(d.emotionalState) ? t(emotionOf(d.emotionalState)!.labelKey) : d.emotionalState,
    value: Number(d.count),
    fill: emotionColor(d.emotionalState),
  }));

  const mostCommon = pieData.length > 0 ? pieData.reduce((a: any, b: any) => a.value > b.value ? a : b) : null;

  const reportRef = useDialogFocus<HTMLDivElement>(true, onClose);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div ref={reportRef} role="dialog" aria-modal="true" aria-label={t("chat.emotionReport")}
        className="relative surface w-full max-w-lg max-h-[85vh] overflow-y-auto animate-fade-in">
        <div className="flex items-center justify-between p-4 border-b border-border sticky top-0 bg-card z-10 rounded-t-lg">
          <h3 className="card-title">
            <span className="font-sans">{personaName}</span> {t("chat.emotionReport")}
          </h3>
          <div className="flex items-center gap-2">
            {/**
             * The range is one control — the reader chooses how far
             * back to look — so it is a group of radio buttons, and the
             * arrow keys move between them.
             *
             * It used to show the chosen range in colour alone, so a
             * screen reader was told about two buttons and nothing
             * about which one was chosen.
             */}
            <div className="flex bg-muted rounded-md p-0.5" role="radiogroup"
              aria-label={t("chat.emotionReport")}
              onKeyDown={(event) => {
                const ranges = [7, 30];
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                event.preventDefault();
                const index = ranges.indexOf(days);
                const step = event.key === "ArrowRight" ? 1 : -1;
                const next = ranges[(index + step + ranges.length) % ranges.length];
                setDays(next);
                /**
                 * The focus moves with the selection.
                 *
                 * The buttons are a roving tabindex — so the one the
                 * focus was on became tabIndex={-1} and aria-checked
                 * "false", and the newly selected one became tabIndex={0}
                 * without being focused. The focus ring stayed on the
                 * old option while the selection moved, and a screen
                 * reader announced the old option as "not checked".
                 */
                document.getElementById(`emotion-range-${next}`)?.focus();
              }}>
              {[7, 30].map(d => (
                <button key={d} id={`emotion-range-${d}`} onClick={() => setDays(d)}
                  role="radio"
                  aria-checked={days === d}
                  tabIndex={days === d ? 0 : -1}
                  className={`text-xs px-3 py-1 rounded-md transition-colors ${days === d ? "bg-card text-foreground" : "text-muted-foreground"}`}>
                  {t("chat.report.days", { count: d })}
                </button>
              ))}
            </div>
            <button onClick={onClose} aria-label={t("common.close")} className="app-nav-icon !h-8 !min-w-8"><X className="w-4 h-4" /></button>
          </div>
        </div>

        <div className="p-4 space-y-6">
          <div className="grid grid-cols-3 gap-3">
            {/* The two counts are about the user's own history.
                A failed request showed them as zero — and the error was
                only rendered further down, under the chart. So the two
                big numbers at the top said "0 chat days" and "0
                messages" about a conversation the user could see. */}
            <div className="bg-muted/40 border border-border rounded-md p-3 text-center">
              <p className="stat-value">{reportFailed || reportLoading ? "—" : report?.totalDays || 0}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{t("chat.report.chatDays")}</p>
            </div>
            <div className="bg-muted/40 border border-border rounded-md p-3 text-center">
              <p className="stat-value">{reportFailed || reportLoading ? "—" : report?.totalMessages || 0}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{t("chat.report.messages")}</p>
            </div>
            <div className="bg-muted/40 border border-border rounded-md p-3 text-center flex flex-col items-center justify-center">
              {mostCommon
                ? <span className="w-5 h-5 rounded-full mt-1" style={{ backgroundColor: mostCommon.fill }} />
                : <p className="stat-value">—</p>}
              <p className="text-xs text-muted-foreground mt-1.5">{mostCommon?.name || t("chat.report.noData")}</p>
            </div>
          </div>

          {chartData.length > 0 ? (
            <>
              <div>
                <p className="text-sm font-medium text-foreground mb-3">{t("chat.report.trend")}</p>
                <div className="h-40 flex items-end gap-1">
                  {chartData.map((d: any, i: number) => (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1" title={t("chat.report.barTitle", { date: formatDayKey(d.date, locale), label: d.label, count: d.messages })}>
                      <div className="w-full rounded-t-sm transition-all hover:opacity-80"
                        style={{ height: `${(d.value / busiest) * 100}%`, backgroundColor: emotionColor(d.state), minHeight: "4px" }} />
                    </div>
                  ))}
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-[10px] text-muted-foreground">{formatDayKey(chartData[0]?.date ?? "", locale)}</span>
                  <span className="text-[10px] text-muted-foreground">{formatDayKey(chartData[chartData.length - 1]?.date ?? "", locale)}</span>
                </div>
              </div>

              <div>
                <p className="text-sm font-medium text-foreground mb-3">{t("chat.report.distribution")}</p>
                <div className="space-y-2">
                  {pieData.map((d: any) => {
                    const total = pieData.reduce((s: number, p: any) => s + p.value, 0);
                    const pct = total > 0 ? Math.round((d.value / total) * 100) : 0;
                    return (
                      <div key={d.name} className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: d.fill }} />
                        <span className="text-xs text-foreground w-12">{d.name}</span>
                        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: d.fill }} />
                        </div>
                        <span className="text-xs text-muted-foreground w-8 text-right">{pct}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          ) : (
            /**
             * A failure is not an empty report.
             *
             * The request failed, so the report was empty, and the
             * panel said "no mood data yet — chat a few more days" —
             * which sent the user off to talk to their persona for a
             * chart that was never going to arrive.
             */
            <div className="text-center py-8 text-muted-foreground text-sm">
              {reportFailed ? (
                <>
                  <p>{t("common.error")}</p>
                  <p className="text-xs mt-1">{t("common.retry")}</p>
                </>
              ) : reportLoading ? (
                <p>{t("common.loading")}</p>
              ) : (
                <>
                  <BarChart3 className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  <p>{t("chat.report.empty")}</p>
                  <p className="text-xs mt-1">{t("chat.report.emptyHint")}</p>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
