import { useLocation } from "wouter";
import { Mail } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { useAuth } from "@/_core/hooks/useAuth";

/**
 * The way into the mailbox (C8.2).
 *
 * Everything that is waiting for the user lives on each persona's own
 * page, so there was no place to look at all of it. The number beside
 * the envelope is plain and only there when there is something: no
 * animation, no movement, no badge at zero — a number that flickers is
 * a number nobody believes.
 */
export default function MailboxEntry() {
  const { t } = useLocale();
  const [, navigate] = useLocation();
  const { isAuthenticated } = useAuth();
  const { data } = trpc.letter.unreadCount.useQuery(undefined, {
    enabled: isAuthenticated,
    refetchInterval: 60_000,
  });
  const count = data?.total ?? 0;
  return (
    <button
      type="button"
      onClick={() => navigate("/letters")}
      className="app-nav-icon mailbox-entry"
      title={t("mailbox.nav")}
      aria-label={
        count > 0 ? t("mailbox.navWithCount", { count }) : t("mailbox.nav")
      }
    >
      <Mail className="w-4 h-4" />
      {count > 0 && (
        <span
          className="mailbox-count"
          data-testid="mailbox-count"
          aria-hidden="true"
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </button>
  );
}
