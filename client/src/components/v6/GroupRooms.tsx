import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Trash2, Users } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { useAuth } from "@/_core/hooks/useAuth";
import { useConfirm } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PersonaAvatar } from "@/components/PersonaAvatar";
import { toast } from "sonner";

/** A member of a room, as the group routes send it. */
export interface GroupRoomMember {
  personaId: number;
  name: string;
  avatarUrl: string | null;
  hasGroupData: boolean;
  available: boolean;
}

/** A room in the lobby's list, as the group routes send it. */
export interface GroupRoom {
  id: number;
  name: string;
  createdAt: string;
  members: GroupRoomMember[];
  lastMessage: { content: string; createdAt: string; personaName: string | null } | null;
}

/** The fewest and most personas a room can hold (C9.8). */
const MIN_MEMBERS = 2;
const MAX_MEMBERS = 5;

/**
 * The lobby's group-chat door and the room dialog (C9.8).
 *
 * Group chat is experimental and off by default. The door does not
 * exist until the account has turned the feature on — a failed or
 * older `auth.me` simply has no `features` field, and then there is
 * nothing to open rather than a broken entry.
 *
 * The dialog is the only place the user creates rooms, opens them, or
 * dissolves them. A create needs a name and two to five analysed
 * personas; a delete asks first, because the messages go with it.
 */
export function GroupRoomsEntry() {
  const { t } = useLocale();
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const enabled = (user as { features?: { groupChat?: boolean } } | null)?.features?.groupChat ?? false;

  if (!enabled) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="app-nav-icon"
        title={t("group.roomsTitle")}
        aria-label={t("group.roomsTitle")}
      >
        <Users className="w-4 h-4" />
      </button>
      {open && (
        <GroupRooms
          open={open}
          onOpenChange={setOpen}
          onOpenRoom={(roomId) => {
            setOpen(false);
            navigate(`/group/${roomId}`);
          }}
        />
      )}
    </>
  );
}

/**
 * The rooms dialog.
 *
 * It takes `onOpenRoom` rather than navigating itself, so the same
 * dialog can be mounted anywhere the lobby can navigate from.
 */
export function GroupRooms({
  open,
  onOpenChange,
  onOpenRoom,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenRoom?: (roomId: number) => void;
}) {
  const { t } = useLocale();
  const confirm = useConfirm();
  const roomsQuery = trpc.group.list.useQuery(undefined, { enabled: open });
  const personasQuery = trpc.persona.list.useQuery(undefined, { enabled: open });
  const createRoom = trpc.group.create.useMutation();
  const deleteRoom = trpc.group.delete.useMutation();

  const [name, setName] = useState<string>(() => t("group.defaultRoomName"));
  const [selected, setSelected] = useState<number[]>([]);
  const wasOpen = useRef(false);

  // Every opening starts a fresh form — the default name and no
  // personas picked.
  useEffect(() => {
    if (open && !wasOpen.current) {
      setName(t("group.defaultRoomName"));
      setSelected([]);
    }
    wasOpen.current = open;
  }, [open, t]);

  const rooms: GroupRoom[] = roomsQuery.data?.rooms ?? [];
  const personas = Array.isArray(personasQuery.data) ? personasQuery.data : [];
  const eligible = personas.filter((persona) => persona.analysisStatus === "ready");
  const canCreate =
    name.trim().length > 0
    && selected.length >= MIN_MEMBERS
    && selected.length <= MAX_MEMBERS
    && !createRoom.isPending;

  function togglePersona(personaId: number) {
    setSelected((current) =>
      current.includes(personaId)
        ? current.filter((id) => id !== personaId)
        : [...current, personaId],
    );
  }

  function submitCreate() {
    if (!canCreate) return;
    createRoom.mutate(
      { name: name.trim().slice(0, 60), personaIds: [...selected] },
      {
        onSuccess: (created: { id: number } | undefined) => {
          toast.success(t("group.created"));
          onOpenChange(false);
          void roomsQuery.refetch();
          if (created?.id) onOpenRoom?.(created.id);
        },
        onError: () => toast.error(t("group.createFailed")),
      },
    );
  }

  async function askDelete(room: GroupRoom) {
    const yes = await confirm({
      title: t("group.deleteRoom"),
      description: t("group.deleteRoomConfirm"),
      confirmLabel: t("group.deleteRoom"),
      cancelLabel: t("group.cancel"),
      destructive: true,
    });
    if (!yes) return;
    deleteRoom.mutate(
      { roomId: room.id },
      {
        onSuccess: () => {
          toast.success(t("group.deleted"));
          void roomsQuery.refetch();
        },
        onError: (error: { message: string }) => toast.error(error.message),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border rounded-lg max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-foreground">
            {t("group.roomsTitle")}
          </DialogTitle>
        </DialogHeader>

        {/* The rooms */}
        <section className="space-y-2" data-testid="group-rooms-list">
          {roomsQuery.isLoading && !roomsQuery.data && (
            <p className="text-xs text-muted-foreground">{t("group.loading")}</p>
          )}
          {roomsQuery.isError && !roomsQuery.data && (
            <div className="flex items-center gap-3">
              <p className="text-xs text-destructive">{t("group.loadFailed")}</p>
              <button
                type="button"
                className="text-xs underline underline-offset-2"
                onClick={() => void roomsQuery.refetch()}
              >
                {t("group.retry")}
              </button>
            </div>
          )}
          {roomsQuery.isError && roomsQuery.data && (
            <div className="flex items-center gap-3">
              <p className="text-xs text-destructive">{t("group.loadFailed")}</p>
              <button
                type="button"
                className="text-xs underline underline-offset-2"
                onClick={() => void roomsQuery.refetch()}
              >
                {t("group.retry")}
              </button>
            </div>
          )}
          {!roomsQuery.isLoading && !roomsQuery.isError && rooms.length === 0 && (
            <p className="text-xs text-muted-foreground">{t("group.noRooms")}</p>
          )}

          {rooms.map((room) => (
            <div
              key={room.id}
              className="flex items-center gap-2 rounded-md border border-border px-3 py-2"
              data-testid="group-room-row"
            >
              <button
                type="button"
                onClick={() => onOpenRoom?.(room.id)}
                className="flex-1 min-w-0 text-left"
              >
                <p className="text-sm font-medium text-foreground truncate">{room.name}</p>
                <p className="text-[11px] text-muted-foreground truncate">
                  {t("group.memberCount", { count: room.members.length })}
                  {room.lastMessage ? ` · ${room.lastMessage.content}` : ""}
                </p>
              </button>
              <div className="flex items-center gap-1 flex-shrink-0">
                {room.members.slice(0, 3).map((member) => (
                  <PersonaAvatar
                    key={member.personaId}
                    name={member.name}
                    url={member.avatarUrl}
                    className="w-5 h-5 rounded-full text-[9px]"
                  />
                ))}
                <button
                  type="button"
                  onClick={() => void askDelete(room)}
                  aria-label={t("group.deleteRoom")}
                  title={t("group.deleteRoom")}
                  className="ml-1 text-muted-foreground hover:text-destructive transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </section>

        {/* A new room */}
        <section className="space-y-3 border-t border-border pt-4" data-testid="group-create-room">
          <h3 className="text-sm font-medium text-foreground">{t("group.newRoom")}</h3>

          <div className="space-y-1.5">
            <Label htmlFor="group-room-name" className="text-xs text-muted-foreground">
              {t("group.roomName")}
            </Label>
            <Input
              id="group-room-name"
              value={name}
              maxLength={60}
              placeholder={t("group.roomNamePlaceholder")}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">{t("group.pickPersonas")}</p>
            {personasQuery.isLoading && !personasQuery.data && (
              <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
            )}
            {personasQuery.isError && (
              <div className="flex items-center gap-3">
                <p className="text-xs text-destructive">{t("common.loadFailed")}</p>
                <button
                  type="button"
                  className="text-xs underline underline-offset-2"
                  onClick={() => void personasQuery.refetch()}
                >
                  {t("group.retry")}
                </button>
              </div>
            )}
            {!personasQuery.isLoading && !personasQuery.isError && eligible.length < MIN_MEMBERS && (
              <p className="text-xs text-muted-foreground">{t("group.noEligiblePersonas")}</p>
            )}
            {eligible.length > 0 && (
              <ul className="max-h-40 space-y-1 overflow-y-auto pr-1" data-testid="group-persona-picker">
                {eligible.map((persona) => (
                  <li key={persona.id}>
                    <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selected.includes(persona.id)}
                        onChange={() => togglePersona(persona.id)}
                      />
                      <span className="truncate">{persona.name}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("group.cancel")}
            </Button>
            <Button type="button" disabled={!canCreate} onClick={submitCreate}>
              {t("group.create")}
            </Button>
          </div>
        </section>
      </DialogContent>
    </Dialog>
  );
}

export default GroupRooms;
