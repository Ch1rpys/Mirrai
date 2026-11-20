import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, Sparkles, Trash2, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  clusterFaceDescriptors,
  cropSquareForFace,
  largestFace,
  type DescribedFace,
} from "@/lib/face-clusters";

interface Photo {
  id: number;
  url: string;
  at: Date | string | null;
  width?: number | null;
  height?: number | null;
}

interface CropRect {
  x: number;
  y: number;
  size: number;
}

interface ClusterView {
  items: DescribedFace[];
  crops: string[];
}

const AVATAR_SIZE = 512;
const MAX_FACE_PHOTOS = 40;

/**
 * The avatar, chosen from a real photograph (B7.8).
 *
 * Two ways in: a picture from this device, or one of the photos
 * already in this persona's album. Either way the browser crops a
 * square and sends 512 pixels, so the server never receives a
 * full-size phone photo just to make a small round icon.
 *
 * The face grouping is optional and runs only when the user asks for
 * it. It happens in this browser; nothing is uploaded and nothing is
 * stored.
 */
export default function AvatarPicker({
  personaId,
  name,
  avatarUrl,
  onChanged,
}: {
  personaId: number;
  name: string;
  avatarUrl?: string | null;
  onChanged?: () => void;
}) {
  const { t } = useLocale();
  const capabilities = trpc.media.capabilities.useQuery();
  const photos = trpc.media.listPhotos.useQuery({ personaId, limit: 200 });
  const uploadMutation = trpc.persona.uploadAvatar.useMutation({
    onSuccess: () => {
      toast.success(t("avatar.saved"));
      setSource(null);
      onChanged?.();
    },
    onError: (error: { message: string }) => toast.error(error.message),
  });
  const clearMutation = trpc.persona.clearAvatar.useMutation({
    onSuccess: () => {
      onChanged?.();
    },
    onError: (error: { message: string }) => toast.error(error.message),
  });

  const [source, setSource] = useState<string | null>(null);
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const [crop, setCrop] = useState<CropRect | null>(null);
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const [faceWorking, setFaceWorking] = useState(false);
  const [clusters, setClusters] = useState<ClusterView[] | null>(null);
  const [faceError, setFaceError] = useState(false);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{ startX: number; startY: number } | null>(null);

  useEffect(() => {
    return () => {
      if (localUrl) URL.revokeObjectURL(localUrl);
    };
  }, [localUrl]);

  function openSource(url: string) {
    setSource(url);
    setCrop(null);
    setNatural({ width: 0, height: 0 });
  }

  function onFile(file: File | undefined) {
    if (!file) return;
    if (localUrl) URL.revokeObjectURL(localUrl);
    const url = URL.createObjectURL(file);
    setLocalUrl(url);
    openSource(url);
  }

  /**
   * Converts a pointer position to a point in the image's own pixels,
   * so the crop is the same whatever size the browser draws it at.
   */
  function pointInImage(event: React.PointerEvent<HTMLDivElement>): { x: number; y: number } | null {
    const image = imageRef.current;
    if (!image || natural.width === 0 || natural.height === 0) return null;
    const rect = image.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return {
      x: ((event.clientX - rect.left) / rect.width) * natural.width,
      y: ((event.clientY - rect.top) / rect.height) * natural.height,
    };
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    const point = pointInImage(event);
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { startX: point.x, startY: point.y };
    setCrop({ x: point.x, y: point.y, size: 0 });
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const start = dragRef.current;
    if (!start) return;
    const point = pointInImage(event);
    if (!point) return;
    const size = Math.min(
      Math.abs(point.x - start.startX),
      Math.abs(point.y - start.startY),
    );
    const x = Math.min(start.startX, point.x);
    const y = Math.min(start.startY, point.y);
    setCrop({
      x: Math.min(Math.max(0, x), natural.width - size),
      y: Math.min(Math.max(0, y), natural.height - size),
      size,
    });
  }

  function onPointerUp() {
    dragRef.current = null;
    setCrop((current) => (current && current.size >= 24 ? current : null));
  }

  async function findFaces() {
    const list = photos.data?.photos ?? [];
    if (list.length === 0) return;
    setFaceWorking(true);
    setFaceError(false);
    setClusters(null);
    try {
      const faceapi = await import("@vladmandic/face-api");
      await faceapi.nets.tinyFaceDetector.loadFromUri("/models/face");
      await faceapi.nets.faceLandmark68Net.loadFromUri("/models/face");
      await faceapi.nets.faceRecognitionNet.loadFromUri("/models/face");

      const faces: DescribedFace[] = [];
      const images = new Map<number, HTMLImageElement>();
      for (const photo of list.slice(0, MAX_FACE_PHOTOS)) {
        const image = await loadImage(photo.url);
        images.set(photo.id, image);
        const detections = await faceapi
          .detectAllFaces(
            image,
            new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 }),
          )
          .withFaceLandmarks()
          .withFaceDescriptors();
        for (const detection of detections) {
          const box = detection.detection.box;
          faces.push({
            photoId: photo.id,
            photoUrl: photo.url,
            descriptor: Array.from(detection.descriptor),
            box: { x: box.x, y: box.y, width: box.width, height: box.height },
            imageWidth: image.naturalWidth,
            imageHeight: image.naturalHeight,
          });
        }
      }
      const grouped = clusterFaceDescriptors(faces);
      setClusters(
        grouped.map((cluster) => ({
          items: cluster.items,
          crops: cluster.items
            .slice(0, 3)
            .map((face) => faceCropDataUrl(face, images.get(face.photoId)))
            .filter((url): url is string => Boolean(url)),
        })),
      );
    } catch {
      setFaceError(true);
    } finally {
      setFaceWorking(false);
    }
  }

  function chooseCluster(cluster: ClusterView) {
    const face = largestFace(cluster.items);
    if (!face) return;
    setSource(face.photoUrl);
    setNatural({ width: face.imageWidth, height: face.imageHeight });
    setCrop(cropSquareForFace(face.box, face.imageWidth, face.imageHeight));
    setClusters(null);
  }

  function save() {
    const image = imageRef.current;
    if (!image || !crop || crop.size <= 0) {
      toast.error(t("avatar.dragHint"));
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_SIZE;
    canvas.height = AVATAR_SIZE;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(
      image,
      crop.x,
      crop.y,
      crop.size,
      crop.size,
      0,
      0,
      AVATAR_SIZE,
      AVATAR_SIZE,
    );
    uploadMutation.mutate({
      personaId,
      base64: canvas.toDataURL("image/jpeg", 0.9),
    });
  }

  const faceModels = capabilities.data?.faceModels === true;
  const album = photos.data?.photos ?? [];
  const cropStyle = crop && natural.width > 0
    ? {
        left: `${(crop.x / natural.width) * 100}%`,
        top: `${(crop.y / natural.height) * 100}%`,
        width: `${(crop.size / natural.width) * 100}%`,
        height: `${(crop.size / natural.height) * 100}%`,
      }
    : undefined;

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-medium text-foreground">{t("avatar.title")}</h3>
        <p className="text-xs text-muted-foreground leading-relaxed mt-1">{t("avatar.note")}</p>
      </div>

      <div className="flex items-start gap-4">
        <div className="w-20 h-20 rounded-full overflow-hidden bg-muted flex-shrink-0">
          {avatarUrl ? (
            <img src={avatarUrl} alt={t("avatar.current", { name })} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-muted-foreground">
              <ImagePlus className="w-6 h-6" />
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="inline-flex items-center gap-1.5 rounded-md border border-input bg-card px-3 py-1.5 text-xs cursor-pointer hover:bg-muted/40">
            <ImagePlus className="w-3.5 h-3.5" />
            {t("avatar.chooseLocal")}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              onChange={(event) => onFile(event.target.files?.[0])}
            />
          </label>
          {avatarUrl && (
            <Button
              size="sm"
              variant="ghost"
              className="rounded-md text-xs"
              disabled={clearMutation.isPending}
              onClick={() => clearMutation.mutate({ personaId })}
            >
              <Trash2 className="w-3.5 h-3.5" /> {t("avatar.remove")}
            </Button>
          )}
        </div>
      </div>

      {source && (
        <div className="space-y-2">
          <div
            className="relative select-none overflow-hidden rounded-md border border-border bg-muted/30 touch-none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <img
              ref={imageRef}
              src={source}
              alt={t("avatar.cropAlt")}
              className="block w-full max-h-[320px] object-contain pointer-events-none"
              onLoad={(event) => {
                const element = event.currentTarget;
                setNatural({ width: element.naturalWidth, height: element.naturalHeight });
              }}
            />
            {cropStyle && (
              <div
                className="absolute border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.35)] pointer-events-none"
                style={cropStyle}
              />
            )}
          </div>
          <p className="text-[11px] text-muted-subtle">{t("avatar.dragHint")}</p>
          <div className="flex gap-2">
            <Button size="sm" className="rounded-md" disabled={!crop || uploadMutation.isPending} onClick={save}>
              {uploadMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {t("avatar.save")}
            </Button>
            <Button size="sm" variant="ghost" className="rounded-md" onClick={() => setSource(null)}>
              <X className="w-3.5 h-3.5" /> {t("avatar.cancel")}
            </Button>
          </div>
        </div>
      )}

      {photos.isError ? (
        <p className="text-xs text-destructive">
          {t("avatar.albumFailed")}{" "}
          <button type="button" className="underline" onClick={() => photos.refetch()}>
            {t("common.retry")}
          </button>
        </p>
      ) : album.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">{t("avatar.fromAlbum")}</p>
          <div className="grid grid-cols-6 sm:grid-cols-8 gap-1.5">
            {album.slice(0, 24).map((photo) => (
              <button
                key={photo.id}
                type="button"
                className="aspect-square overflow-hidden rounded-sm border border-border/60 hover:border-primary transition-colors"
                onClick={() => openSource(photo.url)}
                title={t("avatar.usePhoto")}
              >
                <img src={photo.url} alt="" loading="lazy" className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {faceModels && album.length > 0 && (
        <div className="space-y-2 border-t border-border/60 pt-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              variant="outline"
              className="rounded-md text-xs"
              disabled={faceWorking}
              onClick={findFaces}
            >
              {faceWorking ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              {t("avatar.faceButton", { name })}
            </Button>
            <span className="text-[11px] text-muted-subtle">{t("avatar.faceHint")}</span>
          </div>
          {faceError && <p className="text-xs text-muted-foreground">{t("avatar.faceFailed")}</p>}
          {clusters && clusters.length === 0 && (
            <p className="text-xs text-muted-foreground">{t("avatar.faceEmpty")}</p>
          )}
          {clusters && clusters.length > 0 && (
            <div className="flex flex-wrap gap-3">
              {clusters.slice(0, 8).map((cluster, index) => (
                <button
                  key={index}
                  type="button"
                  className="rounded-md border border-border p-2 hover:border-primary transition-colors space-y-1"
                  onClick={() => chooseCluster(cluster)}
                >
                  <span className="flex gap-1">
                    {cluster.crops.map((url, cropIndex) => (
                      <img
                        key={cropIndex}
                        src={url}
                        alt=""
                        className="w-12 h-12 rounded-sm object-cover"
                      />
                    ))}
                  </span>
                  <span className="block text-[10px] text-muted-foreground">
                    {t("avatar.clusterSize", { n: cluster.items.length })}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image could not be loaded"));
    image.src = url;
  });
}

/** One face as a small square, drawn only in this browser tab. */
function faceCropDataUrl(face: DescribedFace, image?: HTMLImageElement): string | null {
  try {
    if (!image) return null;
    const square = cropSquareForFace(face.box, face.imageWidth, face.imageHeight);
    const canvas = document.createElement("canvas");
    canvas.width = 72;
    canvas.height = 72;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(image, square.x, square.y, square.size, square.size, 0, 0, 72, 72);
    return canvas.toDataURL("image/jpeg", 0.8);
  } catch {
    return null;
  }
}
