import { describe, expect, it } from "vitest";
import { collectSongsFromRows, isSafeMediaUrl } from "./songs";

const at = (day: number) => new Date(Date.UTC(2022, 2, day, 12, 0, 0));
const song = (id: number, role: string, title: string, artist: string, url: string, day: number) => ({
  id,
  role,
  kind: "music",
  timestamp: at(day),
  createdAt: at(day),
  meta: { title, artist, url },
});

describe("the songs in the record", () => {
  it("merges by title and artist and counts who shared them", () => {
    const rows = [
      song(1, "user", "海阔天空", "Beyond", "https://example.com/1", 1),
      song(2, "user", "海阔天空", "Beyond", "https://example.com/1", 2),
      song(3, "assistant", "海阔天空", "Beyond", "https://example.com/1", 3),
      song(4, "assistant", "海阔天空", "Beyond", "", 4),
      song(5, "user", "晴天", "周杰伦", "https://example.com/2", 5),
      song(6, "user", "晴天", "周杰伦", "https://example.com/2", 6),
      song(7, "assistant", "晴天", "周杰伦", "https://example.com/2", 7),
      song(8, "user", "海阔天空", "Beyond", "https://example.com/1", 8),
      song(9, "assistant", "七里香", "周杰伦", "https://example.com/3", 9),
      song(10, "user", "七里香", "周杰伦", "https://example.com/3", 10),
    ];
    const songs = collectSongsFromRows(rows);
    expect(songs).toHaveLength(3);
    const sea = songs.find((item) => item.title === "海阔天空")!;
    expect(sea.count).toBe(5);
    expect(sea.sharedByMe).toBe(3);
    expect(sea.sharedByThem).toBe(2);
    expect(sea.first).toBe(at(1).toISOString());
    expect(sea.artist).toBe("Beyond");
  });

  it("only offers http and https as links", () => {
    expect(isSafeMediaUrl("https://example.com/a")).toBe(true);
    expect(isSafeMediaUrl("http://example.com/a")).toBe(true);
    expect(isSafeMediaUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeMediaUrl("data:text/html,hi")).toBe(false);
    expect(isSafeMediaUrl("not a url")).toBe(false);
  });
});
