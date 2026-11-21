import { useState } from "react";
import { motion } from "framer-motion";
import { Check, Plus, Pencil, Trash2, Copy, Theater, X } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { useConfirm } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { EMOTIONS, EMOTION_KEYS, type EmotionKey } from "@/lib/emotions";
import { normalizeSceneRecordRange } from "@shared/scene-range";

/** The fields the form edits, as the form holds them. */
interface SceneForm {
  name: string;
  icon: string;
  description: string;
  systemPromptOverlay: string;
  starters: string;
  emotionalState: EmotionKey;
}

const EMPTY_FORM: SceneForm = {
  name: "",
  icon: "",
  description: "",
  systemPromptOverlay: "",
  starters: "",
  emotionalState: "warm",
};

function formFromScene(scene: {
  name?: string | null;
  icon?: string | null;
  description?: string | null;
  systemPromptOverlay?: string | null;
  starters?: unknown;
  emotionalState?: string | null;
}): SceneForm {
  const starters = Array.isArray(scene.starters)
    ? scene.starters.filter((line): line is string => typeof line === "string")
    : [];
  const state = EMOTION_KEYS.includes(scene.emotionalState as EmotionKey)
    ? (scene.emotionalState as EmotionKey)
    : "warm";
  return {
    name: String(scene.name ?? ""),
    icon: String(scene.icon ?? ""),
    description: String(scene.description ?? ""),
    systemPromptOverlay: String(scene.systemPromptOverlay ?? ""),
    starters: starters.join("\n"),
    emotionalState: state,
  };
}

/**
 * The scene panel (C8.13).
 *
 * The list of built-in and custom scenes, the form that makes and edits
 * one, and the actions on a scene of the user's own: edit, copy, delete.
 * A built-in scene belongs to the installation, so it can only be
 * copied — the copy is the user's, and that is what they edit.
 *
 * The panel was inline in the chat page until editing was added; it is
 * a component of its own now because the form is used for two things
 * (making a scene and editing one) and both belong in one place.
 */
export default function ScenePanel({
  personaId,
  activeSceneId,
  onClose,
  onPersonaChanged,
}: {
  personaId: number;
  activeSceneId?: number | null;
  onClose: () => void;
  /** The active scene is read from the persona, so activating refetches it. */
  onPersonaChanged: () => void;
}) {
  const { t } = useLocale();
  const confirm = useConfirm();
  const utils = trpc.useUtils();
  const scenesQuery = trpc.scene.list.useQuery(undefined);
  const invalidateScenes = () => void utils.scene.list.invalidate();

  const [editing, setEditing] = useState<{ id: number } | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<SceneForm>(EMPTY_FORM);
  const showForm = creating || editing !== null;

  const activate = trpc.scene.activate.useMutation({
    onSuccess: () => {
      toast.success(t("chat.sceneActivated"));
      invalidateScenes();
      onPersonaChanged();
      onClose();
    },
    onError: (error) => toast.error(error.message),
  });
  const deactivate = trpc.scene.deactivate.useMutation({
    onSuccess: () => {
      toast.success(t("chat.sceneDeactivated"));
      invalidateScenes();
      onPersonaChanged();
      onClose();
    },
    onError: (error) => toast.error(error.message),
  });
  const create = trpc.scene.create.useMutation({
    onSuccess: () => {
      toast.success(t("sceneForm.created"));
      invalidateScenes();
      closeForm();
    },
    onError: (error) => toast.error(t("sceneForm.createFailed", { message: error.message })),
  });
  const update = trpc.scene.update.useMutation({
    onSuccess: () => {
      toast.success(t("sceneForm.saved"));
      invalidateScenes();
      closeForm();
    },
    onError: (error) => toast.error(t("sceneForm.saveFailed", { message: error.message })),
  });
  const duplicate = trpc.scene.duplicate.useMutation({
    onSuccess: () => {
      toast.success(t("sceneForm.duplicated"));
      invalidateScenes();
    },
    onError: (error) => toast.error(t("sceneForm.duplicateFailed", { message: error.message })),
  });
  const remove = trpc.scene.delete.useMutation({
    onSuccess: () => {
      toast.success(t("sceneForm.deleted"));
      invalidateScenes();
    },
    onError: (error) => toast.error(t("sceneForm.deleteFailed", { message: error.message })),
  });

  const pending =
    create.isPending || update.isPending || duplicate.isPending || remove.isPending;

  function closeForm() {
    setCreating(false);
    setEditing(null);
    setForm(EMPTY_FORM);
  }

  function openCreate() {
    setEditing(null);
    setCreating(true);
    setForm(EMPTY_FORM);
  }

  function openEdit(scene: Record<string, unknown>) {
    setCreating(false);
    setEditing({ id: Number(scene.id) });
    setForm(formFromScene(scene as never));
  }

  function submit() {
    const name = form.name.trim();
    if (!name) return;
    const fields = {
      name,
      icon: form.icon.trim() || undefined,
      description: form.description.trim() || undefined,
      systemPromptOverlay: form.systemPromptOverlay.trim() || undefined,
      emotionalState: form.emotionalState,
      starters: form.starters
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    };
    if (editing) update.mutate({ id: editing.id, ...fields });
    else create.mutate(fields);
  }

  const scenes = scenesQuery.data ?? [];
  const activeScene = scenes.find((scene: { id: number }) => scene.id === activeSceneId) as
    | Record<string, any>
    | undefined;

  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: "easeOut" as const }}
        className="absolute inset-x-0 top-full z-40 px-4 pt-2"
      >
        <div className="container max-w-2xl mx-auto">
          <div className="surface p-4 max-h-[70vh] overflow-y-auto" data-testid="scene-panel">
            <div className="flex items-center justify-between mb-3">
              <p className="font-display text-sm font-semibold text-foreground">
                {t("chat.sceneMode")}
              </p>
              <button
                onClick={onClose}
                aria-label={t("common.close")}
                className="app-nav-icon !h-7 !min-w-7"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {activeScene && (
              <div className="mb-3 flex items-center gap-2 px-1 flex-wrap">
                <span className="text-xs text-muted-foreground">
                  {t("chat.currentScene", {
                    scene: `${activeScene.icon ? `${activeScene.icon} ` : ""}${activeScene.name}`,
                  })}
                </span>
                {activeScene.emotionalState &&
                  EMOTIONS[activeScene.emotionalState as EmotionKey] && (
                    <span className="text-xs text-muted-foreground">
                      {t("sceneForm.state", {
                        state: t(EMOTIONS[activeScene.emotionalState as EmotionKey].labelKey),
                      })}
                    </span>
                  )}
              </div>
            )}

            {scenesQuery.isLoading && (
              <p className="text-xs text-muted-foreground">{t("sceneForm.loading")}</p>
            )}
            {!scenesQuery.isLoading && scenesQuery.isError && (
              <div className="flex items-center gap-3">
                <p className="text-xs text-destructive">{t("sceneForm.loadFailed")}</p>
                <button
                  type="button"
                  className="text-xs underline underline-offset-2"
                  onClick={() => scenesQuery.refetch()}
                >
                  {t("sceneForm.retry")}
                </button>
              </div>
            )}
            {!scenesQuery.isLoading && !scenesQuery.isError && scenes.length === 0 && (
              <p className="text-xs text-muted-foreground">{t("sceneForm.empty")}</p>
            )}

            {scenes.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {scenes.map((scene: Record<string, any>) => {
                  const range = normalizeSceneRecordRange(scene.recordRange);
                  return (
                    <div
                      key={scene.id}
                      data-testid="scene-card"
                      className={`relative text-left p-3 rounded-md border transition-colors ${
                        scene.id === activeSceneId
                          ? "border-cinnabar/40 bg-cinnabar/5"
                          : "border-border hover:border-foreground/30 hover:bg-muted/40"
                      }`}
                    >
                      <button
                        onClick={() => activate.mutate({ personaId, sceneId: scene.id })}
                        disabled={activate.isPending}
                        className="w-full text-left"
                      >
                        <div className="flex items-center gap-2 mb-1">
                          {scene.icon ? (
                            <span className="text-base leading-none">{scene.icon}</span>
                          ) : (
                            <Theater className="w-4 h-4 text-muted-foreground" />
                          )}
                          <span className="text-sm font-medium text-foreground flex-1 min-w-0 truncate">
                            {scene.name}
                          </span>
                          {scene.id === activeSceneId && (
                            <Check className="w-3.5 h-3.5 text-cinnabar flex-shrink-0" />
                          )}
                        </div>
                        {scene.description && (
                          <p className="text-xs text-muted-foreground line-clamp-2">
                            {scene.description}
                          </p>
                        )}
                        {range && (
                          <p
                            className="mt-1 text-[10px] text-muted-foreground"
                            title={t("sceneForm.rangeHint")}
                          >
                            {t("sceneForm.rangeBadge")}
                          </p>
                        )}
                      </button>
                      {/* Built-in scenes belong to the installation. They are
                          copied, never edited in place; the copy is editable. */}
                      <div className="absolute top-2 right-2 flex items-center gap-0.5">
                        {scene.isBuiltin ? (
                          <span className="text-[10px] text-muted-foreground mr-1">
                            {t("sceneForm.builtin")}
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => openEdit(scene)}
                            aria-label={`${t("sceneForm.edit")} ${scene.name}`}
                            className="app-nav-icon !h-6 !min-w-6"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => duplicate.mutate({ id: scene.id })}
                          disabled={pending}
                          aria-label={`${t("sceneForm.duplicate")} ${scene.name}`}
                          title={t("sceneForm.duplicate")}
                          className="app-nav-icon !h-6 !min-w-6"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        {!scene.isBuiltin && (
                          <button
                            type="button"
                            onClick={async () => {
                              const yes = await confirm({
                                description: t("sceneForm.confirmDelete"),
                              });
                              if (!yes) return;
                              remove.mutate({ id: scene.id });
                            }}
                            aria-label={`${t("sceneForm.delete")} ${scene.name}`}
                            className="app-nav-icon !h-6 !min-w-6 text-destructive"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {!showForm ? (
              <button
                onClick={openCreate}
                className="mt-3 w-full flex items-center justify-center gap-2 text-xs text-muted-foreground hover:text-foreground border border-dashed border-border rounded-md py-2.5 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                {t("sceneForm.title")}
              </button>
            ) : (
              <div className="mt-3 border-t border-border pt-3 space-y-3">
                <div>
                  <p className="font-display text-sm font-semibold text-foreground">
                    {editing ? t("sceneForm.editTitle") : t("sceneForm.title")}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">{t("sceneForm.note")}</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div className="space-y-1.5 sm:col-span-2">
                    <label className="block text-xs text-muted-foreground">{t("sceneForm.name")}</label>
                    <input
                      value={form.name}
                      onChange={(event) => setForm({ ...form, name: event.target.value })}
                      maxLength={100}
                      placeholder={t("sceneForm.namePlaceholder")}
                      className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground outline-none focus-visible:border-ring"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs text-muted-foreground">{t("sceneForm.icon")}</label>
                    <input
                      value={form.icon}
                      onChange={(event) => setForm({ ...form, icon: event.target.value })}
                      maxLength={10}
                      placeholder={t("sceneForm.iconPlaceholder")}
                      className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground outline-none focus-visible:border-ring"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs text-muted-foreground">{t("sceneForm.description")}</label>
                  <input
                    value={form.description}
                    onChange={(event) => setForm({ ...form, description: event.target.value })}
                    placeholder={t("sceneForm.descriptionPlaceholder")}
                    className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground outline-none focus-visible:border-ring"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs text-muted-foreground">{t("sceneForm.overlay")}</label>
                  <textarea
                    value={form.systemPromptOverlay}
                    onChange={(event) => setForm({ ...form, systemPromptOverlay: event.target.value })}
                    placeholder={t("sceneForm.overlayPlaceholder")}
                    rows={2}
                    className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground outline-none focus-visible:border-ring"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div className="space-y-1.5">
                    <label className="block text-xs text-muted-foreground">{t("sceneForm.emotionalState")}</label>
                    <select
                      value={form.emotionalState}
                      onChange={(event) =>
                        setForm({ ...form, emotionalState: event.target.value as EmotionKey })
                      }
                      className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground outline-none focus-visible:border-ring"
                    >
                      {EMOTION_KEYS.map((key) => (
                        <option key={key} value={key}>
                          {t(EMOTIONS[key].labelKey)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs text-muted-foreground">{t("sceneForm.starters")}</label>
                    <textarea
                      value={form.starters}
                      onChange={(event) => setForm({ ...form, starters: event.target.value })}
                      placeholder={t("sceneForm.startersHint")}
                      rows={2}
                      className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground outline-none focus-visible:border-ring"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={submit}
                    disabled={pending || !form.name.trim()}
                    className="rounded-md px-5"
                  >
                    {editing
                      ? update.isPending
                        ? t("sceneForm.saving")
                        : t("sceneForm.save")
                      : create.isPending
                        ? t("sceneForm.creating")
                        : t("sceneForm.create")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={closeForm} className="rounded-md">
                    {t("common.cancel")}
                  </Button>
                </div>
              </div>
            )}

            {/* Leaving the active scene is the way back to no scene at all. */}
            {activeSceneId != null && (
              <button
                onClick={() => deactivate.mutate({ personaId })}
                className="mt-3 text-xs text-destructive hover:underline"
              >
                {t("chat.noScene")}
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </>
  );
}
