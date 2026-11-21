import { describe, expect, it, vi, beforeEach } from "vitest";

const invoke = vi.fn();

vi.mock("../llm", () => ({
  llmService: {
    invokeWithProvider: (...a: unknown[]) => invoke(...a),
  },
}));

import {
  momentPostsToRecords,
  readMomentScreenshots,
  splitMomentText,
} from "./moments";

const provider = {
  name: "OpenAI",
  capabilities: { streaming: true, vision: true, tools: false, jsonMode: false },
} as never;

describe("the public register", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads one paragraph as one post, from noon when a date is given", () => {
    const posts = splitMomentText("今天去看了海。\n\n周末在家。", {
      date: "2024-06-01",
      timeZone: "Asia/Shanghai",
    });
    expect(posts.map((post) => post.text)).toEqual(["今天去看了海。", "周末在家。"]);
    expect(posts[0]?.at?.toISOString()).toBe("2024-06-01T04:00:00.000Z");
    expect(posts[1]?.at?.toISOString()).toBe("2024-06-01T04:01:00.000Z");
    expect(posts[0]?.timeApprox).toBe(true);
  });

  it("keeps the time empty when there is no date", () => {
    const posts = splitMomentText("一条动态");
    expect(posts[0]?.at).toBeNull();
    expect(posts[0]?.timeApprox).toBe(false);
  });

  it("stores each post as the persona's public words", () => {
    const records = momentPostsToRecords([
      { text: "今天去看了海。", at: "2024-06-01T04:00:00.000Z" },
    ]);
    expect(records[0]).toMatchObject({
      role: "assistant",
      speaker: "them",
      content: "今天去看了海。",
      kind: "text",
      meta: { register: "public" },
    });
    expect(records[0]?.timestamp?.toISOString()).toBe("2024-06-01T04:00:00.000Z");
  });

  it("reads a screenshot of a feed and drops a post shown twice", async () => {
    invoke
      .mockResolvedValueOnce(JSON.stringify({ posts: [{ text: "今天去看了海。" }] }))
      .mockResolvedValueOnce(
        JSON.stringify({ posts: [{ text: "今天去看了海。" }, { text: "周末在家。" }] }),
      );
    const result = await readMomentScreenshots({
      userId: 7,
      personaId: 9,
      images: [
        { name: "a.jpg", base64: "AAAA" },
        { name: "b.jpg", base64: "BBBB" },
      ],
      provider,
      name: "小满",
      date: "2024-06-01",
      timeZone: "Asia/Shanghai",
      locale: "zh",
    });
    expect(result.posts.map((post) => post.text)).toEqual(["今天去看了海。", "周末在家。"]);
    expect(result.failures).toHaveLength(0);
  });

  it("keeps one unreadable screenshot out of the rest", async () => {
    invoke
      .mockResolvedValueOnce("not json")
      .mockResolvedValueOnce(JSON.stringify({ posts: [{ text: "在海边" }] }));
    const result = await readMomentScreenshots({
      userId: 7,
      personaId: 9,
      images: [
        { name: "a.jpg", base64: "AAAA" },
        { name: "b.jpg", base64: "BBBB" },
      ],
      provider,
      name: "小满",
      locale: "zh",
    });
    expect(result.posts.map((post) => post.text)).toEqual(["在海边"]);
    expect(result.failures).toHaveLength(1);
  });
});
