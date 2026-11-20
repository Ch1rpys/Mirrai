/**
 * Grouping the faces in a persona's photos (B7.8).
 *
 * This runs in the browser, on the user's own machine, and nothing is
 * stored: the clusters are a hint for choosing an avatar, not a fact
 * about anybody. A face belongs to a group when its descriptor is
 * closer than half a unit to the group's first face — the number the
 * library's own face matcher documents.
 */
export interface FaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DescribedFace {
  photoId: number;
  photoUrl: string;
  descriptor: number[];
  box: FaceBox;
  imageWidth: number;
  imageHeight: number;
}

export interface FaceCluster {
  items: DescribedFace[];
}

export const FACE_CLUSTER_DISTANCE = 0.5;

/**
 * The biggest face in a cluster.
 *
 * A cluster is a person, not a particular photo. When the user picks
 * it, the crop should start on the clearest look at that person, not
 * on whichever face the detector happened to report first.
 */
export function largestFace(items: DescribedFace[]): DescribedFace | undefined {
  return items.reduce<DescribedFace | undefined>((best, face) => {
    if (!best) return face;
    return face.box.width * face.box.height > best.box.width * best.box.height ? face : best;
  }, undefined);
}

export function euclideanDistance(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  if (length === 0) return Number.POSITIVE_INFINITY;
  let sum = 0;
  for (let i = 0; i < length; i += 1) {
    const diff = a[i]! - b[i]!;
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

/**
 * Greedy clustering, largest group first.
 *
 * The first face of a group is its centre. Every later face joins the
 * first group it is close enough to; this is deterministic for a given
 * order, which is what the picker shows.
 */
export function clusterFaceDescriptors(
  items: DescribedFace[],
  threshold = FACE_CLUSTER_DISTANCE,
): FaceCluster[] {
  const clusters: FaceCluster[] = [];
  for (const item of items) {
    let joined = false;
    for (const cluster of clusters) {
      if (euclideanDistance(cluster.items[0]!.descriptor, item.descriptor) < threshold) {
        cluster.items.push(item);
        joined = true;
        break;
      }
    }
    if (!joined) clusters.push({ items: [item] });
  }
  return clusters.sort((a, b) => b.items.length - a.items.length);
}

/**
 * The square to start a crop at, around one face.
 *
 * The face box is expanded by 40% so hair and chin fit, kept square,
 * and clamped inside the photograph.
 */
export function cropSquareForFace(
  box: FaceBox,
  imageWidth: number,
  imageHeight: number,
): { x: number; y: number; size: number } {
  const centreX = box.x + box.width / 2;
  const centreY = box.y + box.height / 2;
  const wanted = Math.max(box.width, box.height) * 1.4;
  const size = Math.max(1, Math.min(wanted, imageWidth, imageHeight));
  const x = Math.min(Math.max(0, centreX - size / 2), imageWidth - size);
  const y = Math.min(Math.max(0, centreY - size / 2), imageHeight - size);
  return { x, y, size };
}
