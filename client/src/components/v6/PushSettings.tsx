import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

/**
 * Browser notifications, off until the user turns them on.
 *
 * Rendering this does not call `Notification.requestPermission`. The
 * prompt only happens from the switch.
 */

function supportedHere(): boolean {
  return typeof window !== "undefined"
    && "PushManager" in window
    && "Notification" in window
    && "serviceWorker" in navigator;
}

function iosHere(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

/** VAPID public keys arrive as base64url. PushManager wants bytes. */
function urlBase64ToUint8Array(value: string): Uint8Array {
  const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export default function PushSettings() {
  const { t } = useLocale();
  const supported = supportedHere();
  const ios = iosHere();
  const [permission, setPermission] = useState(
    supported ? Notification.permission : "default",
  );
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const publicKey = trpc.push.publicKey.useQuery(undefined, { enabled: supported });
  const list = trpc.push.list.useQuery(undefined, { enabled: supported });
  const subscribe = trpc.push.subscribe.useMutation({
    onSuccess: () => list.refetch(),
  });
  const unsubscribe = trpc.push.unsubscribe.useMutation({
    onSuccess: () => list.refetch(),
  });
  const setPreview = trpc.push.setPreview.useMutation({
    onSuccess: () => list.refetch(),
  });
  const testPush = trpc.push.test.useMutation({
    onSuccess: () => setSent(true),
  });

  const rows = list.data ?? [];
  const on = rows.length > 0;
  const preview = on && rows.every((row) => row.showPreview);
  const failed = supported && (list.isError || publicKey.isError);
  const loading = supported && (list.isLoading || publicKey.isLoading) && !failed;

  let status: string = t("settings.data.pushOff");
  if (!supported) status = t("settings.data.pushUnsupported");
  else if (loading) status = t("settings.data.pushLoading");
  else if (failed) status = t("settings.data.pushFailed");
  else if (permission === "denied") status = t("settings.data.pushDenied");
  else if (on) status = t("settings.data.pushOn");

  async function onToggle(next: boolean) {
    if (!supported || busy) return;
    setBusy(true);
    try {
      if (!next) {
        const ready = await navigator.serviceWorker.ready;
        const current = await ready.pushManager.getSubscription();
        await current?.unsubscribe();
        await Promise.all(rows.map((row) => unsubscribe.mutateAsync({ endpoint: row.endpoint })));
        return;
      }
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== "granted") return;
      const key = publicKey.data?.publicKey;
      if (!key) return;
      const ready = await navigator.serviceWorker.ready;
      const existing = await ready.pushManager.getSubscription();
      const sub = existing ?? await ready.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
      });
      const json = sub.toJSON();
      if (!json.keys?.p256dh || !json.keys.auth) return;
      await subscribe.mutateAsync({
        endpoint: sub.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      });
    } finally {
      setBusy(false);
    }
  }

  async function onPreview(next: boolean) {
    await Promise.all(rows.map((row) => setPreview.mutateAsync({
      endpoint: row.endpoint,
      showPreview: next,
    })));
  }

  return (
    <section className="surface p-5 sm:p-6">
      <div className="mb-4">
        <h2 className="font-display text-lg sm:text-xl font-semibold text-foreground">
          {t("settings.data.pushTitle")}
        </h2>
        <p className="kicker mt-1.5">{status}</p>
      </div>
      {failed ? (
        <Button type="button" size="sm" variant="outline" onClick={() => {
          void list.refetch();
          void publicKey.refetch();
        }}>
          {t("settings.data.pushRetry")}
        </Button>
      ) : null}
      {supported && !loading && !failed ? (
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm text-foreground">{t("settings.data.pushSwitch")}</p>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                {t("settings.data.pushSwitchNote")}
              </p>
            </div>
            <Switch
              checked={on && permission !== "denied"}
              disabled={permission === "denied" || busy}
              onCheckedChange={(next) => { void onToggle(next); }}
              aria-label={t("settings.data.pushSwitch")}
            />
          </div>
          {on ? (
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm text-foreground">{t("settings.data.pushPreview")}</p>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  {t("settings.data.pushPreviewNote")}
                </p>
              </div>
              <Switch
                checked={preview}
                disabled={busy}
                onCheckedChange={(next) => { void onPreview(next); }}
                aria-label={t("settings.data.pushPreview")}
              />
            </div>
          ) : null}
          {on ? (
            <div className="flex items-center gap-3">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={testPush.isPending}
                onClick={() => testPush.mutate()}
              >
                {t("settings.data.pushTest")}
              </Button>
              {sent ? <p className="text-xs text-muted-foreground">{t("settings.data.pushSent")}</p> : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {ios ? (
        <p className="text-xs text-muted-foreground mt-4 leading-relaxed">
          {t("settings.data.pushIos")}
        </p>
      ) : null}
    </section>
  );
}
