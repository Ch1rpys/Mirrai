import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { formatDateTimeInZone } from "@/lib/dates";
import { renderRecordContent } from "@shared/records";
import { isKeptName, redactRecords } from "@shared/redact";
import TagInput from "./TagInput";

type RoleChoice = "me" | "them" | "other";

type ColumnMapState = {
  time: number;
  speaker: number;
  content: number;
  fromMe: number;
  fromMeTrue: string;
};

const NONE = -1;
const EMPTY_SPEAKERS: Array<{ name: string; count: number }> = [];
const EMPTY_CHATS: Array<{ id: string; title: string; count: number }> = [];

function emptyColumnMap(): ColumnMapState {
  return { time: NONE, speaker: NONE, content: NONE, fromMe: NONE, fromMeTrue: "1" };
}

function payloadOf(map: ColumnMapState): {
  time?: number;
  speaker?: number;
  content: number;
  fromMe?: number;
  fromMeTrue?: string;
} | undefined {
  if (map.content < 0) return undefined;
  return {
    content: map.content,
    time: map.time >= 0 ? map.time : undefined,
    speaker: map.speaker >= 0 ? map.speaker : undefined,
    fromMe: map.fromMe >= 0 ? map.fromMe : undefined,
    fromMeTrue: map.fromMe >= 0 ? map.fromMeTrue : undefined,
  };
}

function guessColumnMap(headers: string[]): ColumnMapState {
  const lower = headers.map((h) => h.toLowerCase());
  const indexOf = (names: string[]) => {
    for (const name of names) {
      const i = lower.indexOf(name);
      if (i >= 0) return i;
    }
    return NONE;
  };
  return {
    time: indexOf(["time", "timestamp", "date", "datetime", "strtime", "created_at"]),
    speaker: indexOf(["speaker", "sender", "name", "user", "nickname", "from"]),
    content: indexOf(["content", "message", "body", "text", "strcontent"]),
    fromMe: indexOf(["fromme", "is_sender", "issender", "sent"]),
    fromMeTrue: "1",
  };
}

/**
 * One uploaded chat file, from detection through the first records.
 *
 * The server stops before it writes when it cannot name the two sides.
 * This card is that pause: format, conversation, roles, then a preview
 * that does not write, then confirm.
 */
export default function ImportWizard(props: {
  fileId: number;
  personaName: string;
  userName?: string | null;
  timezone?: string | null;
}) {
  const { t, locale } = useLocale();
  const [, navigate] = useLocation();
  const [selectedFormat, setSelectedFormat] = useState("");
  const [columnMapOpen, setColumnMapOpen] = useState(false);
  const [columnMap, setColumnMap] = useState<ColumnMapState>(emptyColumnMap);
  const [chatId, setChatId] = useState("");
  const [roles, setRoles] = useState<Record<string, RoleChoice>>({});
  const [columnGuessed, setColumnGuessed] = useState(false);
  const [hidePhones, setHidePhones] = useState(false);
  const [hideIds, setHideIds] = useState(false);
  const [hideEmails, setHideEmails] = useState(false);
  const [hideCards, setHideCards] = useState(false);
  const [hideNames, setHideNames] = useState<string[]>([]);
  const [keepHint, setKeepHint] = useState("");

  const statusQuery = trpc.import.status.useQuery(
    { fileId: props.fileId },
    {
      refetchInterval: (query) => {
        if (query.state.error) return false;
        const status = query.state.data?.parseStatus;
        return status === "detecting" || status === "importing" ? 1500 : false;
      },
    },
  );
  const formatsQuery = trpc.import.formats.useQuery();
  const status = statusQuery.data;
  const report = status?.parseReport ?? null;
  const parseStatus = status?.parseStatus ?? null;
  const formats = formatsQuery.data ?? [];

  const speakers = report?.speakers ?? EMPTY_SPEAKERS;
  const chats = report?.chats ?? EMPTY_CHATS;
  const meNames = useMemo(
    () => speakers.filter((row) => roles[row.name] === "me").map((row) => row.name),
    [speakers, roles],
  );
  const themNames = useMemo(
    () => speakers.filter((row) => roles[row.name] === "them").map((row) => row.name),
    [speakers, roles],
  );
  const hasMe = meNames.length > 0;
  const hasThem = themNames.length > 0;
  const keepNames = useMemo(
    () => [props.personaName, props.userName, ...meNames, ...themNames].filter(
      (name): name is string => Boolean(name && name.trim()),
    ),
    [props.personaName, props.userName, meNames, themNames],
  );
  const formatId = selectedFormat || report?.format || "";
  const columnPayload = useMemo(() => payloadOf(columnMap), [columnMap]);
  const showColumnMap = columnMapOpen || formatId === "column-map";

  const previewEnabled =
    (parseStatus === "needs_roles" && hasMe && hasThem && Boolean(formatId)) ||
    (showColumnMap && Boolean(columnPayload) && (parseStatus === "needs_format" || parseStatus === "needs_roles"));

  const previewQuery = trpc.import.preview.useQuery(
    {
      fileId: props.fileId,
      format: formatId ? (formatId as "generic-line") : undefined,
      chatId: chatId || undefined,
      me: hasMe ? meNames : undefined,
      them: hasThem ? themNames : undefined,
      columnMap: showColumnMap ? columnPayload : undefined,
    },
    { enabled: previewEnabled },
  );

  const refetchStatus = () => {
    void statusQuery.refetch();
  };

  const applyMutation = trpc.import.resume.useMutation({
    onSuccess: refetchStatus,
  });
  const confirmMutation = trpc.import.confirm.useMutation({
    onSuccess: refetchStatus,
  });
  const cancelMutation = trpc.import.cancel.useMutation({
    onSuccess: refetchStatus,
  });

  useEffect(() => {
    if (report?.format && !selectedFormat) setSelectedFormat(report.format);
  }, [report?.format, selectedFormat]);

  useEffect(() => {
    if (!speakers.length) return;
    setRoles((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const speaker of speakers) {
        if (next[speaker.name]) continue;
        if (props.personaName && speaker.name.trim() === props.personaName.trim()) {
          next[speaker.name] = "them";
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [speakers, props.personaName]);

  useEffect(() => {
    const headers = report?.rawTable?.headers;
    if (!headers?.length || columnGuessed) return;
    setColumnMap(guessColumnMap(headers));
    setColumnGuessed(true);
  }, [report?.rawTable?.headers, columnGuessed]);

  const formatLabel = (id: string | undefined) =>
    formats.find((row) => row.id === id)?.label ?? id ?? "";

  const busy = applyMutation.isPending || confirmMutation.isPending || cancelMutation.isPending;

  const confirmImport = () => {
    if (!formatId || !hasMe || !hasThem) return;
    const hiding = hidePhones || hideIds || hideEmails || hideCards || hideNames.length > 0;
    void confirmMutation.mutateAsync({
      fileId: props.fileId,
      format: formatId as "generic-line",
      me: meNames,
      them: themNames,
      chatId: chatId || undefined,
      columnMap: showColumnMap ? columnPayload : undefined,
      redaction: hiding
        ? {
            phones: hidePhones,
            ids: hideIds,
            emails: hideEmails,
            cards: hideCards,
            names: hideNames,
          }
        : undefined,
    });
  };

  const applyFormat = () => {
    if (!formatId) return;
    void applyMutation.mutateAsync({
      fileId: props.fileId,
      format: formatId as "generic-line",
      columnMap: showColumnMap ? columnPayload : undefined,
    });
  };

  const goToTimezone = () => {
    navigate("/settings?tab=profile");
  };

  if (statusQuery.error) {
    return (
      <p className="text-xs text-destructive mt-2" role="alert">
        {statusQuery.error.message}
      </p>
    );
  }

  if (!status) return null;

  const preview = previewQuery.data;
  const previewReport = preview?.report ?? report;
  const previewRows = preview?.records ?? [];

  return (
    <div className="mt-3 space-y-3 text-sm">
      {(parseStatus === "detecting" || parseStatus === "importing") && (
        <BusyPanel
          status={parseStatus}
          written={report?.written ?? 0}
          progress={report?.progress ?? 0}
          pending={cancelMutation.isPending}
          onCancel={() => cancelMutation.mutate({ fileId: props.fileId })}
        />
      )}

      {parseStatus === "needs_format" && (
        <div className="space-y-3">
          <p className="text-foreground leading-relaxed">{t("importWizard.unknownFormat")}</p>
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">{t("importWizard.formatLabel")}</span>
            <select
              aria-label={t("importWizard.formatLabel")}
              className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm"
              value={selectedFormat}
              onChange={(e) => {
                const next = e.target.value;
                setSelectedFormat(next);
                setColumnMapOpen(next === "column-map");
              }}
            >
              <option value="">{t("importWizard.formatLabel")}</option>
              {formats.map((row) => (
                <option key={row.id} value={row.id}>{row.label}</option>
              ))}
            </select>
          </label>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="rounded-md"
            onClick={() => {
              setSelectedFormat("column-map");
              setColumnMapOpen(true);
            }}
          >
            {t("importWizard.columnMap")}
          </Button>
          {showColumnMap && (
            <ColumnMapPanel
              headers={report?.rawTable?.headers ?? []}
              rows={report?.rawTable?.rows ?? []}
              map={columnMap}
              onChange={setColumnMap}
              previewRows={previewRows}
            />
          )}
          <Button
            type="button"
            size="sm"
            className="rounded-md"
            disabled={!formatId || busy || (showColumnMap && !columnPayload)}
            onClick={applyFormat}
          >
            {t("importWizard.useFormat")}
          </Button>
        </div>
      )}

      {parseStatus === "needs_chat" && (
        <div className="space-y-3">
          <p className="text-foreground leading-relaxed">{t("importWizard.chatPrompt")}</p>
          <div className="space-y-2">
            {chats.map((chat) => (
              <label key={chat.id} className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`import-chat-${props.fileId}`}
                  value={chat.id}
                  checked={chatId === chat.id}
                  onChange={() => setChatId(chat.id)}
                />
                <span>{chat.title}</span>
                <span className="text-xs text-muted-foreground">
                  {t("importWizard.chatCount", { count: chat.count })}
                </span>
              </label>
            ))}
          </div>
          <Button
            type="button"
            size="sm"
            className="rounded-md"
            disabled={!chatId || busy}
            onClick={() => applyMutation.mutate({
              fileId: props.fileId,
              format: formatId ? formatId as "generic-line" : undefined,
              chatId,
            })}
          >
            {t("importWizard.continue")}
          </Button>
        </div>
      )}

      {parseStatus === "needs_roles" && (
        <div className="space-y-3">
          <p className="text-foreground leading-relaxed">
            {t("importWizard.rolesPrompt", { count: speakers.length, name: props.personaName })}
          </p>
          <div className="space-y-3">
            {speakers.map((speaker) => (
              <fieldset key={speaker.name} className="rounded-md border border-border/70 p-3">
                <legend className="px-1 text-sm text-foreground">
                  {speaker.name}
                  <span className="text-muted-foreground">
                    {" "}
                    {t("importWizard.speakerCount", { count: speaker.count })}
                  </span>
                </legend>
                <div className="flex flex-wrap gap-4 pt-1">
                  {(["me", "them", "other"] as const).map((choice) => (
                    <label key={choice} className="inline-flex items-center gap-1.5 text-sm">
                      <input
                        type="radio"
                        name={`import-role-${props.fileId}-${speaker.name}`}
                        value={choice}
                        checked={roles[speaker.name] === choice}
                        onChange={() => setRoles((prev) => ({ ...prev, [speaker.name]: choice }))}
                      />
                      {choice === "me"
                        ? t("importWizard.role.me")
                        : choice === "them"
                          ? t("importWizard.role.them")
                          : t("importWizard.role.other")}
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
          {showColumnMap && report?.rawTable && (
            <ColumnMapPanel
              headers={report.rawTable.headers}
              rows={report.rawTable.rows}
              map={columnMap}
              onChange={setColumnMap}
              previewRows={previewRows}
            />
          )}
          {(hasMe && hasThem) && (
            <PreviewPanel
              formatLabel={formatLabel(formatId)}
              report={previewReport}
              rows={previewRows}
              total={preview?.total ?? speakers.reduce((n, row) => n + row.count, 0)}
              timezone={props.timezone}
              personaName={props.personaName}
              locale={locale}
              onTimezone={goToTimezone}
              keepNames={keepNames}
              hidePhones={hidePhones}
              hideIds={hideIds}
              hideEmails={hideEmails}
              hideCards={hideCards}
              hideNames={hideNames}
              keepHint={keepHint}
              onHidePhones={setHidePhones}
              onHideIds={setHideIds}
              onHideEmails={setHideEmails}
              onHideCards={setHideCards}
              onHideNames={(names) => {
                setHideNames(names);
                setKeepHint("");
              }}
              onRejectName={(name) => {
                if (!isKeptName(name, keepNames)) return false;
                setKeepHint(t("importWizard.redactKeepHint", { name: name.trim() }));
                return true;
              }}
            />
          )}
          <Button
            type="button"
            size="sm"
            className="rounded-md"
            disabled={!hasMe || !hasThem || !formatId || busy}
            onClick={confirmImport}
          >
            {t("importWizard.continue")}
          </Button>
        </div>
      )}

      {parseStatus === "done" && (
        <p className="text-foreground leading-relaxed">
          {t("importWizard.done", {
            added: report?.written ?? 0,
            theirs: report?.roleCounts?.assistant ?? 0,
            name: props.personaName,
            existing: report?.existing ?? 0,
          })}
        </p>
      )}

      {parseStatus === "failed" && (
        <div className="space-y-2">
          <p className="text-destructive leading-relaxed">
            {t("importWizard.failedTitle")}
            {report?.failedReason ? ` ${report.failedReason}` : ""}
          </p>
          <Button
            type="button"
            size="sm"
            className="rounded-md"
            disabled={busy}
            onClick={() => applyMutation.mutate({ fileId: props.fileId })}
          >
            {t("importWizard.retry")}
          </Button>
        </div>
      )}
    </div>
  );
}

function BusyPanel(props: {
  status: "detecting" | "importing";
  written: number;
  progress: number;
  pending: boolean;
  onCancel: () => void;
}) {
  const { t } = useLocale();
  return (
    <div className="space-y-2">
      <p className="text-muted-foreground">
        {props.status === "detecting" ? t("importWizard.detecting") : t("importWizard.importing")}
      </p>
      <Progress value={props.progress} />
      <p className="text-xs text-muted-foreground">
        {t("importWizard.progress", { written: props.written })}
      </p>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="rounded-md"
        disabled={props.pending}
        onClick={props.onCancel}
      >
        {props.pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
        {t("importWizard.cancel")}
      </Button>
    </div>
  );
}

function ColumnMapPanel(props: {
  headers: string[];
  rows: string[][];
  map: ColumnMapState;
  onChange: (next: ColumnMapState) => void;
  previewRows: Array<{ speaker: string; content: string; timestamp: string | null }>;
}) {
  const { t } = useLocale();
  const headers = props.headers;
  const set = (patch: Partial<ColumnMapState>) => props.onChange({ ...props.map, ...patch });

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{t("importWizard.rawTable")}</p>
      {headers.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-left">
                {headers.map((header, i) => (
                  <th key={`${header}-${i}`} className="px-2 py-1.5 font-medium">{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {props.rows.map((row, r) => (
                <tr key={r} className="border-t border-border/70">
                  {headers.map((_, c) => (
                    <td key={c} className="px-2 py-1.5 text-muted-foreground">{row[c] ?? ""}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <ColumnSelect
          label={t("importWizard.timeColumn")}
          headers={headers}
          value={props.map.time}
          allowNone
          onChange={(time) => set({ time })}
        />
        <ColumnSelect
          label={t("importWizard.speakerColumn")}
          headers={headers}
          value={props.map.speaker}
          allowNone
          onChange={(speaker) => set({ speaker })}
        />
        <ColumnSelect
          label={t("importWizard.contentColumn")}
          headers={headers}
          value={props.map.content}
          onChange={(content) => set({ content })}
        />
        <ColumnSelect
          label={t("importWizard.fromMeColumn")}
          headers={headers}
          value={props.map.fromMe}
          allowNone
          onChange={(fromMe) => set({ fromMe })}
        />
      </div>
      {props.map.fromMe >= 0 && (
        <label className="block space-y-1">
          <span className="text-xs text-muted-foreground">{t("importWizard.fromMeTrue")}</span>
          <input
            className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
            value={props.map.fromMeTrue}
            onChange={(e) => set({ fromMeTrue: e.target.value })}
          />
        </label>
      )}
      {props.previewRows.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{t("importWizard.columnPreview")}</p>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {props.previewRows.slice(0, 8).map((row, i) => (
              <li key={i}>{row.speaker}: {row.content}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ColumnSelect(props: {
  label: string;
  headers: string[];
  value: number;
  allowNone?: boolean;
  onChange: (value: number) => void;
}) {
  const { t } = useLocale();
  return (
    <label className="block space-y-1">
      <span className="text-xs text-muted-foreground">{props.label}</span>
      <select
        aria-label={props.label}
        className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      >
        {props.allowNone ? <option value={NONE}>{t("importWizard.none")}</option> : (
          <option value={NONE}>{props.label}</option>
        )}
        {props.headers.map((header, i) => (
          <option key={`${header}-${i}`} value={i}>{header || `#${i + 1}`}</option>
        ))}
      </select>
    </label>
  );
}

function PreviewPanel(props: {
  formatLabel: string;
  report: {
    timeRange?: { firstAt?: string; lastAt?: string };
    roleCounts?: Record<string, number>;
    kindCounts?: Record<string, number>;
    skipped?: number;
    warnings?: Array<{ code: string; lineNo?: number; detail?: string }>;
  } | null;
  rows: Array<{ timestamp: string | null; speaker: string; content: string; kind: string }>;
  total: number;
  timezone?: string | null;
  personaName: string;
  locale: string;
  onTimezone: () => void;
  keepNames: string[];
  hidePhones: boolean;
  hideIds: boolean;
  hideEmails: boolean;
  hideCards: boolean;
  hideNames: string[];
  keepHint: string;
  onHidePhones: (value: boolean) => void;
  onHideIds: (value: boolean) => void;
  onHideEmails: (value: boolean) => void;
  onHideCards: (value: boolean) => void;
  onHideNames: (names: string[]) => void;
  onRejectName: (name: string) => boolean;
}) {
  const { t } = useLocale();
  const report = props.report;
  const kindSummary = Object.entries(report?.kindCounts ?? {})
    .map(([kind, count]) => `${kind} ${count}`)
    .join(" · ");
  const warnings = (report?.warnings ?? []).slice(0, 5);
  const shown = redactRecords(props.rows, {
    phones: props.hidePhones,
    ids: props.hideIds,
    emails: props.hideEmails,
    cards: props.hideCards,
    names: props.hideNames,
    keepNames: props.keepNames,
  }).records;

  return (
    <div className="space-y-2 rounded-md border border-border/70 p-3">
      <p className="font-medium text-foreground">{t("importWizard.previewTitle")}</p>
      <p className="text-xs text-muted-foreground">
        {t("importWizard.formatNamed", { format: props.formatLabel })}
        {" · "}
        {t("importWizard.total", { count: props.total })}
      </p>
      {report?.timeRange?.firstAt && (
        <p className="text-xs text-muted-foreground">
          {t("importWizard.range", {
            from: formatDateTimeInZone(report.timeRange.firstAt, props.locale, props.timezone),
            to: formatDateTimeInZone(report.timeRange.lastAt, props.locale, props.timezone),
          })}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {t("importWizard.sides", {
          me: report?.roleCounts?.user ?? 0,
          them: report?.roleCounts?.assistant ?? 0,
          name: props.personaName,
        })}
      </p>
      {kindSummary ? (
        <p className="text-xs text-muted-foreground">
          {t("importWizard.kinds", { summary: kindSummary })}
        </p>
      ) : null}
      {(report?.skipped ?? 0) > 0 && (
        <p className="text-xs text-muted-foreground">
          {t("importWizard.skipped", { count: report?.skipped ?? 0 })}
        </p>
      )}
      {warnings.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground">{t("importWizard.warningsTitle")}</p>
          <ul className="text-xs text-muted-foreground">
            {warnings.map((row, i) => (
              <li key={i}>{row.code}{row.lineNo != null ? ` #${row.lineNo}` : ""}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-muted-foreground leading-relaxed">
        {props.timezone
          ? t("importWizard.timezoneNote", { timezone: props.timezone })
          : t("importWizard.noTimezone")}
        {" "}
        <button
          type="button"
          className="underline underline-offset-4"
          onClick={props.onTimezone}
        >
          {t("importWizard.settingsTimezone")}
        </button>
      </p>
      <fieldset className="space-y-2 rounded-md border border-border/70 p-3">
        <legend className="px-1 text-sm text-foreground">{t("importWizard.redactTitle")}</legend>
        <p className="text-xs text-muted-foreground leading-relaxed">{t("importWizard.redactLead")}</p>
        <div className="flex flex-wrap gap-4">
          <label className="inline-flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={props.hidePhones}
              onChange={(e) => props.onHidePhones(e.target.checked)}
            />
            {t("importWizard.redactPhones")}
          </label>
          <label className="inline-flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={props.hideIds}
              onChange={(e) => props.onHideIds(e.target.checked)}
            />
            {t("importWizard.redactIds")}
          </label>
          <label className="inline-flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={props.hideEmails}
              onChange={(e) => props.onHideEmails(e.target.checked)}
            />
            {t("importWizard.redactEmails")}
          </label>
          <label className="inline-flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={props.hideCards}
              onChange={(e) => props.onHideCards(e.target.checked)}
            />
            {t("importWizard.redactCards")}
          </label>
        </div>
        <TagInput
          id={`import-redact-names-${props.personaName}`}
          label={t("importWizard.redactNames")}
          tags={props.hideNames}
          onChange={props.onHideNames}
          reject={props.onRejectName}
        />
        {props.keepHint ? (
          <p className="text-xs text-muted-foreground">{props.keepHint}</p>
        ) : null}
      </fieldset>
      {shown.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 pr-2 font-medium">{t("importWizard.when")}</th>
                <th className="py-1 pr-2 font-medium">{t("importWizard.who")}</th>
                <th className="py-1 font-medium">{t("importWizard.what")}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row, i) => (
                <tr key={i} className="border-t border-border/70 align-top">
                  <td className="py-1 pr-2 whitespace-nowrap text-muted-foreground">
                    {row.timestamp
                      ? formatDateTimeInZone(row.timestamp, props.locale, props.timezone)
                      : "—"}
                  </td>
                  <td className="py-1 pr-2">{row.speaker}</td>
                  <td className="py-1">
                    {renderRecordContent({ kind: row.kind, content: row.content }, props.locale === "en" ? "en" : "zh")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
