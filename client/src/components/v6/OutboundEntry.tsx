import { Inbox } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";

/**
 * The way-out list's door in the chat menu (C3.3).
 *
 * It carries the count so the user can see there is something there
 * without opening the drawer. In memorial mode (C7.1) the same door says
 * what it is for in that mode's words: the sentences that came too late.
 */
export default function OutboundEntry({
  personaId,
  name,
  memorial,
  onOpen,
}: {
  personaId: number;
  name: string;
  memorial?: boolean;
  onOpen: () => void;
}) {
  const { t } = useLocale();
  const { data } = trpc.outbound.list.useQuery({ personaId });
  const count = data?.letters?.length ?? 0;
  const label = memorial
    ? t("chat.outboundEntryMemorial", { name, n: count })
    : t("chat.outboundEntry", { name, n: count });
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-foreground hover:bg-muted/60 rounded-md transition-colors text-left"
    >
      <Inbox className="w-4 h-4 text-muted-foreground shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}
