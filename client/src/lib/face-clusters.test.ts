import { describe, expect, it } from "vitest";
import {
  clusterFaceDescriptors,
  cropSquareForFace,
  euclideanDistance,
  type DescribedFace,
} from "./face-clusters";

function face(photoId: number, descriptor: number[], box = { x: 10, y: 10, width: 20, height: 20 }): DescribedFace {
  return {
    photoId,
    photoUrl: `/uploads/${photoId}.jpg`,
    descriptor,
    box,
    imageWidth: 100,
    imageHeight: 100,
  };
}

describe("grouping faces", () => {
  it("measures the distance between two descriptors", () => {
    expect(euclideanDistance([0, 0], [3, 4])).toBe(5);
    expect(euclideanDistance([], [1])).toBe(Number.POSITIVE_INFINITY);
  });

  it("puts two close faces in one group and a far one in its own", () => {
    const clusters = clusterFaceDescriptors([
      face(1, [0, 0, 0]),
      face(2, [0.1, 0, 0]),
      face(3, [5, 5, 5]),
      face(4, [0.05, 0, 0]),
    ]);
    expect(clusters).toHaveLength(2);
    expect(clusters[0]?.items.map((item) => item.photoId)).toEqual([1, 2, 4]);
    expect(clusters[1]?.items.map((item) => item.photoId)).toEqual([3]);
  });

  it("sorts the biggest group first", () => {
    const clusters = clusterFaceDescriptors([
      face(1, [0, 0]),
      face(2, [5, 5]),
      face(3, [5.1, 5]),
      face(4, [5.2, 5]),
    ]);
    expect(clusters[0]?.items).toHaveLength(3);
    expect(clusters[1]?.items).toHaveLength(1);
  });
});

describe("starting a crop at a face", () => {
  it("makes a square around the face and keeps it inside the photo", () => {
    expect(cropSquareForFace({ x: 40, y: 40, width: 20, height: 20 }, 100, 100)).toEqual({
      x: 36,
      y: 36,
      size: 28,
    });
  });

  it("clamps a face at the edge", () => {
    const square = cropSquareForFace({ x: 0, y: 0, width: 30, height: 30 }, 100, 100);
    expect(square.x).toBe(0);
    expect(square.y).toBe(0);
    expect(square.size).toBe(42);
  });
});
