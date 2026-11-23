import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

/**
 * The three bot channels of C9.1: Telegram, Discord, Matrix.
 *
 * A bot account is public — anybody who finds it can message it — so the
 * channel only answers a conversation that has been bound with the
 * one-time code shown here. The code and the "start" button are the whole
 * setup; the credentials are encrypted at rest by the server.
 */
type BotChannel = "telegram" | "discord" | "matrix";

const CHANNELS: Array<{ id: BotChannel; label: string; needsHomeserver: boolean }> = [
  { id: "telegram", label: "Telegram", needsHomeserver: false },
  { id: "discord", label: "Discord", needsHomeserver: false },
  { id: "matrix", label: "Matrix", needsHomeserver: true },
];

function BotChannelCard({ channel, label, needsHomeserver }: {
  channel: BotChannel;
  label: string;
  needsHomeserver: boolean;
}) {
  const { t } = useLocale();
  const [token, setToken] = useState("");
  const [homeserver, setHomeserver] = useState("");
  const [personaId, setPersonaId] = useState("");
  const status = trpc.channel.getStatus.useQuery({ channel });
  const personas = trpc.persona.list.useQuery();
  const channelDefault = trpc.channel.getChannelDefault.useQuery({ channel });

  const save = trpc.channel.setBotCredentials.useMutation({
    onSuccess: () => {
      toast.success(t("channelsBot.saved"));
      setToken("");
      status.refetch();
    },
    onError: (error: any) => toast.error(error.message),
  });
  const start = trpc.channel.start.useMutation({
    onSuccess: () => {
      toast.success(t("channelsBot.started"));
      status.refetch();
    },
    onError: (error: any) => toast.error(error.message),
  });
  const stop = trpc.channel.stop.useMutation({
    onSuccess: () => {
      toast.success(t("channelsBot.stopped"));
      status.refetch();
    },
    onError: (error: any) => toast.error(error.message),
  });
  const setDefault = trpc.channel.setChannelDefault.useMutation({
    onSuccess: () => {
      toast.success(t("channelsBot.personaSaved"));
      channelDefault.refetch();
    },
    onError: (error: any) => toast.error(error.message),
  });

  const code = (status.data?.detail as { bindCode?: unknown } | null | undefined)?.bindCode;
  const bindCode = typeof code === "string" ? code : null;
  const connected = Boolean(status.data?.connected);
  const readyPersonas = (personas.data ?? []).filter(
    (persona) => persona.analysisStatus === "ready",
  );

  return (
    <section className="surface p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium">{label}</h3>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            {t("channelsBot.note")}
          </p>
        </div>
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {status.isError
            ? t("channelsBot.loadFailed")
            : connected
              ? t("channelsBot.running")
              : t("channelsBot.stopped")}
        </span>
      </div>

      <div className="space-y-2.5">
        {needsHomeserver && (
          <label className="flex flex-wrap items-center gap-2 text-sm">
            <span className="min-w-[9rem]">{t("channelsBot.homeserverLabel")}</span>
            <input
              value={homeserver}
              onChange={(event) => setHomeserver(event.target.value)}
              placeholder="matrix.example.org"
              className="h-9 min-w-[12rem] flex-1 rounded-md border border-input bg-background px-2 text-sm"
            />
          </label>
        )}
        <label className="flex flex-wrap items-center gap-2 text-sm">
          <span className="min-w-[9rem]">
            {needsHomeserver
              ? t("channelsBot.accessTokenLabel")
              : t("channelsBot.tokenLabel")}
          </span>
          <input
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder={needsHomeserver ? "syt_…" : "123456:ABC…"}
            className="h-9 min-w-[12rem] flex-1 rounded-md border border-input bg-background px-2 text-sm"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            className="rounded-md px-4"
            disabled={!token.trim() || save.isPending}
            onClick={() => {
              const credentials: Record<string, string> = { accessToken: token.trim(), botToken: token.trim() };
              if (needsHomeserver) credentials.homeserverUrl = homeserver.trim();
              save.mutate({ channel, credentials });
            }}
          >
            {t("channelsBot.save")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="rounded-md bg-transparent"
            disabled={start.isPending}
            onClick={() => start.mutate({ channel })}
          >
            {t("channelsBot.start")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={stop.isPending}
            onClick={() => stop.mutate({ channel })}
          >
            {t("channelsBot.stop")}
          </Button>
        </div>

        {bindCode && (
          <div className="rounded-md border border-border/70 bg-muted/30 p-3 space-y-1.5" data-testid={`bind-code-${channel}`}>
            <p className="text-sm">
              {t("channelsBot.bindHeading", { channel: label, code: bindCode })}
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t("channelsBot.bindNote")}
            </p>
          </div>
        )}

        <label className="flex flex-wrap items-center gap-2 text-sm">
          <span className="min-w-[9rem]">{t("channelsBot.personaLabel")}</span>
          <select
            aria-label={t("channelsBot.personaLabel")}
            value={personaId || String(channelDefault.data?.personaId ?? "")}
            onChange={(event) => {
              const next = event.target.value;
              setPersonaId(next);
              if (next) setDefault.mutate({ channel, personaId: Number(next) });
            }}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">—</option>
            {readyPersonas.map((persona) => (
              <option key={persona.id} value={persona.id}>{persona.name}</option>
            ))}
          </select>
        </label>
        {readyPersonas.length === 0 && (
          <p className="text-xs text-muted-foreground">{t("channelsBot.noPersonas")}</p>
        )}
      </div>
    </section>
  );
}

export default function BotChannels() {
  return (
    <div className="space-y-5">
      {CHANNELS.map((channel) => (
        <BotChannelCard key={channel.id} channel={channel.id} label={channel.label} needsHomeserver={channel.needsHomeserver} />
      ))}
    </div>
  );
}
