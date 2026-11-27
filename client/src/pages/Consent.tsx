/**
 * The page the other person opens from a consent link (C10.3).
 *
 * No account, no cookie, no id. It shows the fixed explanation and the
 * name of the person being modelled, and asks one question with two
 * answers. A token that is invalid, expired or already used all look the
 * same — the page cannot tell a stranger which is which.
 */
import { useEffect, useState } from "react";
import { useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import PageLoader from "@/components/PageLoader";
import { Button } from "@/components/ui/button";

function Section({ heading, body }: { heading: string; body: string }) {
  return (
    <section>
      <h2 className="text-sm font-semibold text-foreground mt-5 mb-1">{heading}</h2>
      <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
    </section>
  );
}

export default function Consent() {
  const params = useParams<{ token: string }>();
  const token = params.token ?? "";
  const { t } = useLocale();
  const [answered, setAnswered] = useState(false);

  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex";
    document.head.appendChild(meta);
    return () => {
      meta.remove();
    };
  }, []);

  const { data, isLoading, isError } = trpc.consent.getByToken.useQuery(
    { token },
    { enabled: token.length > 0 },
  );
  const answer = trpc.consent.answer.useMutation({
    onSuccess: () => setAnswered(true),
  });

  if (!token) {
    return (
      <p className="p-6 text-sm text-destructive" role="alert">
        {t("consent.link.invalid")}
      </p>
    );
  }
  if (isLoading) return <PageLoader />;
  if (isError || !data) {
    return (
      <div className="mx-auto max-w-xl p-6">
        <p className="text-sm text-destructive" role="alert">
          {t("consent.link.invalid")}
        </p>
      </div>
    );
  }

  if (answered) {
    return (
      <div className="mx-auto max-w-xl space-y-4 p-6 sm:p-10">
        <h1 className="font-display text-xl font-semibold text-foreground">{t("consent.link.title")}</h1>
        <p className="text-sm text-foreground" role="status">{t("consent.link.answered")}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-4 p-6 sm:p-10">
      <h1 className="font-display text-xl font-semibold text-foreground">{t("consent.link.title")}</h1>
      <p className="text-sm text-muted-foreground leading-relaxed">
        {t("consent.link.lead", { name: data.name })}
      </p>
      <Section heading={t("consent.link.whatHeading")} body={t("consent.link.whatBody")} />
      <Section heading={t("consent.link.dataHeading")} body={t("consent.link.dataBody")} />
      <Section heading={t("consent.link.neverHeading")} body={t("consent.link.neverBody")} />
      <Section heading={t("consent.link.noHeading")} body={t("consent.link.noBody")} />
      <div className="flex flex-wrap gap-2 pt-2">
        <Button
          disabled={answer.isPending}
          onClick={() => answer.mutate({ token, answer: "yes" })}
        >
          {t("consent.link.yes")}
        </Button>
        <Button
          variant="outline"
          className="bg-transparent"
          disabled={answer.isPending}
          onClick={() => answer.mutate({ token, answer: "no" })}
        >
          {t("consent.link.no")}
        </Button>
      </div>
      {answer.isPending && (
        <p className="text-xs text-muted-subtle" role="status">{t("consent.link.submitting")}</p>
      )}
      {answer.isError && (
        <p className="text-xs text-destructive" role="alert">{t("consent.link.invalid")}</p>
      )}
      <p className="text-xs text-muted-subtle pt-4">{t("consent.link.footer")}</p>
    </div>
  );
}
