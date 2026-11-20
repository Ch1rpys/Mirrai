import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

/**
 * The user's own mail server (C5.5).
 *
 * Only the server is configured here. The switch that sends a persona's
 * replies to it is on that persona's page — a single mailbox can serve
 * several personas, and each relationship decides separately.
 */
export default function EmailDelivery() {
  const { t } = useLocale();
  const config = trpc.email.getConfig.useQuery();
  const save = trpc.email.saveConfig.useMutation({
    onSuccess: () => {
      toast.success(t("email.saved"));
      config.refetch();
    },
    onError: (error) => toast.error(error.message),
  });
  const test = trpc.email.test.useMutation({
    onSuccess: (result) =>
      result.sent ? toast.success(t("email.testSent")) : toast.error(t("email.testFailed")),
    onError: (error) => toast.error(error.message),
  });
  const clear = trpc.email.clear.useMutation({
    onSuccess: () => {
      toast.success(t("email.cleared"));
      config.refetch();
    },
    onError: (error) => toast.error(error.message),
  });

  const [host, setHost] = useState("");
  const [port, setPort] = useState("587");
  const [secure, setSecure] = useState(false);
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [subjectWithName, setSubjectWithName] = useState(false);

  useEffect(() => {
    const data = config.data;
    if (!data) return;
    setHost(data.host ?? "");
    setPort(String(data.port ?? 587));
    setSecure(Boolean(data.secure));
    setUser(data.user ?? "");
    setFrom(data.from ?? "");
    setTo(data.to ?? "");
    setSubjectWithName(Boolean(data.subjectWithName));
    setPass("");
  }, [config.data]);

  if (config.isLoading) {
    return <p className="text-xs text-muted-foreground">{t("common.loading")}</p>;
  }
  if (config.isError) {
    return (
      <p className="text-xs text-muted-foreground">
        {t("email.loadFailed")}{" "}
        <button type="button" onClick={() => config.refetch()} className="underline underline-offset-2">
          {t("common.retry")}
        </button>
      </p>
    );
  }

  function submit() {
    if (!host.trim() || !user.trim() || !from.trim() || !to.trim()
      || (!config.data?.configured && !pass.trim())) {
      toast.error(t("email.required"));
      return;
    }
    const portNumber = Number.parseInt(port, 10);
    save.mutate({
      host: host.trim(),
      port: Number.isFinite(portNumber) ? portNumber : 587,
      secure,
      user: user.trim(),
      pass: pass.trim() || undefined,
      from: from.trim(),
      to: to.trim(),
      subjectWithName,
    });
  }

  return (
    <section className="surface p-5 sm:p-6 space-y-3">
      <div>
        <h2 className="section-title">{t("email.title")}</h2>
        <p className="text-muted-foreground text-sm mt-1">{t("email.hint")}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-xs">
          <Label htmlFor="email-host" className="text-xs text-muted-foreground">{t("email.host")}</Label>
          <Input id="email-host" value={host} onChange={(event) => setHost(event.target.value)} />
        </label>
        <label className="space-y-1 text-xs">
          <Label htmlFor="email-port" className="text-xs text-muted-foreground">{t("email.port")}</Label>
          <Input id="email-port" inputMode="numeric" value={port} onChange={(event) => setPort(event.target.value)} />
        </label>
        <label className="space-y-1 text-xs">
          <Label htmlFor="email-user" className="text-xs text-muted-foreground">{t("email.username")}</Label>
          <Input id="email-user" value={user} onChange={(event) => setUser(event.target.value)} />
        </label>
        <label className="space-y-1 text-xs">
          <Label htmlFor="email-pass" className="text-xs text-muted-foreground">{t("email.password")}</Label>
          <Input
            id="email-pass"
            type="password"
            value={pass}
            placeholder={config.data?.configured ? t("email.passwordKeep") : ""}
            onChange={(event) => setPass(event.target.value)}
          />
        </label>
        <label className="space-y-1 text-xs">
          <Label htmlFor="email-from" className="text-xs text-muted-foreground">{t("email.from")}</Label>
          <Input id="email-from" type="email" value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label className="space-y-1 text-xs">
          <Label htmlFor="email-to" className="text-xs text-muted-foreground">{t("email.to")}</Label>
          <Input id="email-to" type="email" value={to} onChange={(event) => setTo(event.target.value)} />
        </label>
      </div>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={secure} onChange={(event) => setSecure(event.target.checked)} />
        {t("email.secure")}
      </label>
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={subjectWithName}
          onChange={(event) => setSubjectWithName(event.target.checked)}
        />
        {t("email.subjectWithName")}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={submit} disabled={save.isPending}>
          {t("email.save")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="bg-transparent"
          disabled={test.isPending || !config.data?.configured}
          onClick={() => test.mutate()}
        >
          {t("email.test")}
        </Button>
        {config.data?.configured && (
          <Button size="sm" variant="ghost" disabled={clear.isPending} onClick={() => clear.mutate()}>
            {t("email.clear")}
          </Button>
        )}
        {!config.data?.configured && (
          <span className="text-xs text-muted-foreground">{t("email.notConfigured")}</span>
        )}
      </div>
    </section>
  );
}
