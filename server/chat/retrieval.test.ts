import { describe, expect, it, vi, beforeEach } from "vitest";

const getMemoriesByPersonaId = vi.fn();
const getFilesByPersonaId = vi.fn();
const getFileSummariesByPersonaId = vi.fn();
const touchMemoryRecalled = vi.fn();

vi.mock("../db", () => ({
  getMemoriesByPersonaId: (...a: unknown[]) => getMemoriesByPersonaId(...a),
  getFilesByPersonaId: (...a: unknown[]) => getFilesByPersonaId(...a),
  getFileSummariesByPersonaId: (...a: unknown[]) => getFileSummariesByPersonaId(...a),
  touchMemoryRecalled: (...a: unknown[]) => touchMemoryRecalled(...a),
}));

import {
  tokenize,
  keywordCoverage,
  scoreMemory,
  selectMemories,
  formatMemoriesForPrompt,
  formatAnchorsForPrompt,
  fileSummaryCandidates,
  retrieveMemories,
  type MemoryCandidate,
} from "./retrieval";

function candidate(overrides: Partial<MemoryCandidate> = {}): MemoryCandidate {
  return {
    id: 1,
    title: "第一次见面",
    description: "在图书馆门口，她迟到了",
    category: "memory",
    date: "2019-05-20",
    subject: "them",
    isPinned: false,
    importance: 1,
    lastRecalledAt: null,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("tokenize", () => {
  it("splits Latin words", () => {
    const tokens = tokenize("the library was quiet");
    expect(tokens.has("library")).toBe(true);
    expect(tokens.has("the")).toBe(true);
  });

  it("splits Chinese into bigrams", () => {
    const tokens = tokenize("图书馆");
    expect(tokens.has("图书")).toBe(true);
    expect(tokens.has("书馆")).toBe(true);
  });

  it("keeps a single Chinese character", () => {
    expect(tokenize("书").has("书")).toBe(true);
  });

  it("handles empty input", () => {
    expect(tokenize("").size).toBe(0);
  });
});

describe("keywordCoverage", () => {
  it("is high when the memory matches the message", () => {
    const tokens = tokenize("你还记得图书馆那次吗");
    expect(keywordCoverage("第一次见面在图书馆门口", tokens)).toBeGreaterThan(0);
  });

  it("is zero when nothing matches", () => {
    const tokens = tokenize("今天天气不错");
    expect(keywordCoverage("第一次见面在图书馆门口", tokens)).toBe(0);
  });

  it("is zero for an empty message", () => {
    expect(keywordCoverage("第一次见面", new Set())).toBe(0);
  });

  it("does not let a long message make an unrelated memory look relevant", () => {
    // One shared word, in a message that is mostly about something
    // else.
    const short = tokenize("图书馆");
    const long = tokenize("图书馆 今天 天气 很好 我们 晚上 去 看 电影 好 不好");
    expect(keywordCoverage("图书馆", short)).toBeGreaterThan(
      keywordCoverage("图书馆", long),
    );
  });

  it("does not make a long memory unreachable", () => {
    // A long description used to need twenty shared words with the
    // message to clear the floor, while a short title needed one — so
    // the summaries of an uploaded file were never retrieved.
    const longMemory = "第一次见面在图书馆门口 她穿着一件白色的外套 那天下了小雨 我们在门口的长椅上坐了很久 聊起了她最喜欢的书";
    const message = tokenize("第一次见面在图书馆门口 她穿着一件白色的外套");
    expect(keywordCoverage(longMemory, message)).toBeGreaterThan(0.5);
  });
});

describe("scoreMemory", () => {
  const now = new Date("2025-01-01T00:00:00Z").getTime();

  it("scores a matching memory above an unrelated one", () => {
    const tokens = tokenize("图书馆");
    const matching = scoreMemory(candidate(), tokens, now);
    const unrelated = scoreMemory(
      candidate({ id: 2, title: "去吃火锅", description: "排队很久" }),
      tokens,
      now,
    );
    expect(matching).toBeGreaterThan(unrelated);
  });

  it("gives a pinned memory a boost", () => {
    const tokens = tokenize("图书馆");
    const plain = scoreMemory(candidate(), tokens, now);
    const pinned = scoreMemory(candidate({ isPinned: true }), tokens, now);
    expect(pinned).toBeGreaterThan(plain);
  });

  it("damps a memory that was just recalled", () => {
    const tokens = tokenize("图书馆");
    const fresh = scoreMemory(candidate(), tokens, now);
    const justRecalled = scoreMemory(
      candidate({ lastRecalledAt: new Date(now - 60_000) }),
      tokens,
      now,
    );
    expect(justRecalled).toBeLessThan(fresh);
  });

  it("does not damp a memory recalled long ago", () => {
    const tokens = tokenize("图书馆");
    const fresh = scoreMemory(candidate(), tokens, now);
    const longAgo = scoreMemory(
      candidate({ lastRecalledAt: new Date(now - 48 * 60 * 60 * 1000) }),
      tokens,
      now,
    );
    expect(longAgo).toBeCloseTo(fresh, 5);
  });

  it("weights a milestone above an ordinary memory", () => {
    const tokens = tokenize("图书馆");
    const ordinary = scoreMemory(candidate({ category: "memory" }), tokens, now);
    const milestone = scoreMemory(candidate({ category: "milestone" }), tokens, now);
    expect(milestone).toBeGreaterThan(ordinary);
  });
});

describe("selectMemories", () => {
  const now = new Date("2025-01-01T00:00:00Z").getTime();

  it("always includes anchors", () => {
    const { selected, anchors } = selectMemories(
      [
        candidate({ id: 1, category: "anchor", title: "生日", description: "3 月 14 日" }),
        candidate({ id: 2, title: "去吃火锅", description: "排队很久" }),
      ],
      "今天有点无聊",
      { now },
    );

    expect(anchors).toHaveLength(1);
    expect(selected.map((m) => m.id)).toContain(1);
  });

  it("does not include an ordinary memory with no keyword match", () => {
    const { selected } = selectMemories(
      [candidate({ id: 2, title: "去吃火锅", description: "排队很久" })],
      "今天有点无聊",
      { now },
    );
    expect(selected).toHaveLength(0);
  });

  it("includes an ordinary memory that matches", () => {
    const { selected } = selectMemories(
      [candidate({ id: 2, title: "图书馆", description: "在里面看书" })],
      "你还记得图书馆吗",
      { now },
    );
    expect(selected.map((m) => m.id)).toContain(2);
  });

  it("keeps a pinned memory when the ones that match the message are better", () => {
    // A pin was worth a tenth of the score, so a memory that matched
    // the message well could push out the very fact the user had
    // pinned — and the persona stopped using it.
    const many = Array.from({ length: 12 }, (_, index) =>
      candidate({
        id: 100 + index,
        category: "anchor",
        title: "图书馆",
        description: "在里面看书",
      }),
    );
    const { selected } = selectMemories(
      [
        ...many,
        candidate({ id: 1, category: "anchor", isPinned: true, title: "她的生日", description: "3 月 14 日" }),
      ],
      "你还记得图书馆吗",
      { now },
    );

    expect(selected.map((m) => m.id)).toContain(1);
  });

  it("always includes a pinned memory even without a keyword match", () => {
    const { selected } = selectMemories(
      [candidate({ id: 3, isPinned: true, title: "去吃火锅", description: "排队很久" })],
      "今天有点无聊",
      { now },
    );
    expect(selected.map((m) => m.id)).toContain(3);
  });

  it("respects the top-K limit for ordinary memories", () => {
    const memories = Array.from({ length: 10 }, (_, i) =>
      candidate({ id: i + 1, title: `图书馆 ${i}`, description: "在里面看书" }),
    );
    const { selected } = selectMemories(memories, "图书馆", { topK: 3, now });
    expect(selected).toHaveLength(3);
  });

  it("hops to a memory that shares a place with the top hit", () => {
    const { selected } = selectMemories(
      [
        candidate({
          id: 1,
          title: "第一次约会在拾光咖啡",
          description: null,
          entities: { people: [], places: ["拾光咖啡"], things: [] },
        }),
        candidate({
          id: 2,
          title: "拾光咖啡的老板养了只橘猫",
          description: null,
          entities: { people: [], places: ["拾光咖啡"], things: [] },
        }),
      ],
      "还记得我们第一次约会吗",
      { now, topK: 1 },
    );
    expect(selected.map((row) => row.id)).toEqual([1, 2]);
  });
});

describe("prompt rendering", () => {
  it("renders the memory section", () => {
    const text = formatMemoriesForPrompt([
      { ...candidate(), score: 1 },
    ]);
    expect(text).toContain("【相关记忆】");
    expect(text).toContain("第一次见面");
  });

  it("marks a said memory, and never puts it among the anchors", () => {
    const text = formatMemoriesForPrompt([
      { ...candidate({ subject: "said", title: "周三下午有课" }), score: 1 },
    ]);
    expect(text).toContain("这是你在这里说过的话，不是记录里的事实");
    expect(text).not.toContain("（事实）");

    const now = new Date("2025-01-01T00:00:00Z").getTime();
    const { anchors, selected } = selectMemories(
      [
        candidate({
          id: 1,
          subject: "said",
          category: "anchor",
          title: "周三下午有课",
          description: "我周三下午有课",
        }),
        candidate({
          id: 2,
          category: "anchor",
          title: "生日",
          description: "5月21号",
        }),
      ],
      "你周三下午有课吗",
      { now },
    );
    expect(anchors.map((m) => m.id)).toEqual([2]);
    expect(selected.map((m) => m.id)).toContain(1);
    expect(selected.map((m) => m.id)).toContain(2);
  });

  it("renders nothing when there are no memories", () => {
    expect(formatMemoriesForPrompt([])).toBe("");
  });

  it("renders the anchor section with the no-hallucination rule", () => {
    const text = formatAnchorsForPrompt([
      { ...candidate({ category: "anchor", title: "生日", description: "3 月 14 日" }), score: 1 },
    ]);
    expect(text).toContain("【事实锚点（不得违背）】");
    expect(text).toContain("不要编造");
  });
});

describe("file summaries", () => {
  beforeEach(() => {
    getMemoriesByPersonaId.mockReset();
    getFilesByPersonaId.mockReset();
    getFileSummariesByPersonaId.mockReset();
    getFileSummariesByPersonaId.mockResolvedValue([]);
    touchMemoryRecalled.mockReset();
    getMemoriesByPersonaId.mockResolvedValue([]);
    getFilesByPersonaId.mockResolvedValue([]);
    touchMemoryRecalled.mockResolvedValue(undefined);
  });

  function uploadedFile(overrides: Record<string, unknown> = {}) {
    return {
      id: 7,
      personaId: 1,
      userId: 1,
      fileType: "chat_txt",
      originalName: "聊天记录.txt",
      fileKey: "chat/1/1/abc.txt",
      fileUrl: "/uploads/abc.txt",
      fileSize: 100,
      extractedMemory: "我们在图书馆第一次见面，她迟到了半小时",
      processStatus: "done",
      createdAt: new Date("2025-06-01T00:00:00Z"),
      ...overrides,
    };
  }

  it("turns the summary of an uploaded file into a candidate", () => {
    const candidates = fileSummaryCandidates([uploadedFile() as any]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].description).toContain("图书馆");
    expect(candidates[0].category).toBe("file_summary");
    // A negative id keeps it apart from the `memories` table.
    expect(candidates[0].id).toBeLessThan(0);
  });

  it("skips a file without an extracted summary", () => {
    expect(fileSummaryCandidates([uploadedFile({ extractedMemory: "  " }) as any])).toHaveLength(0);
  });

  it("offers the file summary when the message matches it", async () => {
    getFilesByPersonaId.mockResolvedValue([uploadedFile()]);
    getFileSummariesByPersonaId.mockResolvedValue([uploadedFile()]);

    const memories = await retrieveMemories({
      personaId: 1,
      userId: 1,
      userMessage: "你还记得图书馆吗",
    });

    expect(memories).toHaveLength(1);
    expect(memories[0].category).toBe("file_summary");
    expect(memories[0].description).toContain("图书馆");
  });

  it("keeps the file summary below the pinned and anchor memories", async () => {
    getMemoriesByPersonaId.mockResolvedValue([
      {
        id: 1,
        title: "生日",
        description: "3 月 14 日",
        category: "anchor",
        date: null,
        isPinned: false,
        importance: 1,
        lastRecalledAt: null,
        createdAt: new Date("2025-01-01T00:00:00Z"),
      },
      {
        id: 2,
        title: "图书馆",
        description: "在里面看书",
        category: "memory",
        date: null,
        isPinned: true,
        importance: 1,
        lastRecalledAt: null,
        createdAt: new Date("2025-01-01T00:00:00Z"),
      },
    ]);
    getFilesByPersonaId.mockResolvedValue([uploadedFile()]);
    getFileSummariesByPersonaId.mockResolvedValue([uploadedFile()]);

    const memories = await retrieveMemories({
      personaId: 1,
      userId: 1,
      userMessage: "你还记得图书馆吗",
    });

    expect(memories.map((m) => m.category)).toEqual(["anchor", "memory", "file_summary"]);
  });

  it("does not mark a file summary as a recalled memory", async () => {
    getFilesByPersonaId.mockResolvedValue([uploadedFile()]);
    getFileSummariesByPersonaId.mockResolvedValue([uploadedFile()]);

    await retrieveMemories({
      personaId: 1,
      userId: 1,
      userMessage: "你还记得图书馆吗",
    });

    expect(touchMemoryRecalled).not.toHaveBeenCalled();
  });

  it("does not offer a file summary when the persona already has memories from the records", async () => {
    getMemoriesByPersonaId.mockResolvedValue([
      {
        id: 1,
        title: "生日",
        description: "5月21号",
        category: "anchor",
        date: "05-21",
        isPinned: false,
        importance: 5,
        lastRecalledAt: null,
        createdAt: new Date("2025-01-01T00:00:00Z"),
        source: "records",
      },
    ]);
    getFilesByPersonaId.mockResolvedValue([uploadedFile()]);
    getFileSummariesByPersonaId.mockResolvedValue([uploadedFile()]);

    const memories = await retrieveMemories({
      personaId: 1,
      userId: 1,
      userMessage: "你还记得图书馆吗",
    });

    expect(memories.some((row) => row.category === "file_summary")).toBe(false);
    expect(getFileSummariesByPersonaId).not.toHaveBeenCalled();
  });
});
