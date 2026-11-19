import { describe, expect, it } from "vitest";
import { measurePhotos, normalizePhotoStats } from "./photo-stats";

function turn(
  id: number,
  role: "user" | "assistant",
  kind: "text" | "image",
  state: string,
  at: string,
) {
  return {
    id,
    role,
    kind,
    content: kind === "image" ? "[image]" : "在的",
    emotion: state,
    timestamp: new Date(at),
  };
}

/** Ten scenes, each with one picture turn and one text turn. */
function rows() {
  const out = [];
  for (let i = 0; i < 10; i += 1) {
    const day = String(i + 1).padStart(2, "0");
    out.push(turn(i * 3 + 1, "assistant", "image", i % 2 === 0 ? "happy" : "warm", `2024-06-${day}T12:00:00Z`));
    out.push(turn(i * 3 + 2, "user", "text", i % 2 === 0 ? "happy" : "warm", `2024-06-${day}T12:01:00Z`));
    out.push(turn(i * 3 + 3, "assistant", "text", i % 2 === 0 ? "happy" : "warm", `2024-06-${day}T12:02:00Z`));
  }
  return out;
}

describe("measuring photos", () => {
  it("counts picture turns, not picture rows", () => {
    const stats = measurePhotos(rows());
    expect(stats).not.toBeNull();
    expect(stats!.samples).toBe(10);
    expect(stats!.rate).toBe(0.5);
    expect(stats!.byState.happy?.turns).toBe(10);
    expect(stats!.byState.happy?.rate).toBe(0.5);
    expect(stats!.byState.warm?.rate).toBe(0.5);
  });

  it("returns null with fewer than ten picture turns", () => {
    const all = rows();
    const nine = all.filter((_, index) => index !== 0);
    expect(measurePhotos(nine)).toBeNull();
  });

  it("reads a stored measurement back and drops a broken one", () => {
    const stats = measurePhotos(rows())!;
    expect(normalizePhotoStats(stats)).toEqual(stats);
    expect(normalizePhotoStats({ samples: 9, rate: 0.5, byState: {} })).toBeNull();
    expect(normalizePhotoStats({ samples: 20, rate: 2, byState: {} })).toBeNull();
    expect(normalizePhotoStats(null)).toBeNull();
  });
});
