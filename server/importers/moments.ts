/**
 * Moments — the public register (B7.12).
 *
 * Two ways in: a paragraph of pasted text, or a screenshot of the feed.
 * Either way each post is stored as an assistant text row with
 * `meta.register = "public"`, so the private-voice measurements never
 * read it.
 */
import { copy, type Locale } from "@shared/copy";
import { parseZoneless } from "@shared/timezone";
import type { LLMProvider } from "../llm/types";
import { llmService } from "../llm";
import { extractJsonObject } from "../_core/json";
import { parseTimeBar } from "./screenshot-merge";
import type { ScreenshotImage } from "./screenshot";
import type { ParsedRecord, RecordRole } from "@shared/records";

export interface MomentPost {
  text: string;
  at: Date | null;
  timeApprox: boolean;
}

export interface MomentReadFailure {
  index: number;
  message: string;
}

function baseForDate(date: string | null | undefined, timeZone?: string | null): Date | null {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return parseZoneless(`${date} 12:00:00`, timeZone);
}

/** One paragraph, one post. Blank lines separate posts. */
export function splitMomentText(
  text: string,
  options: { date?: string | null; timeZone?: string | null } = {},
): MomentPost[] {
  const blocks = String(text ?? "")
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);
  const base = baseForDate(options.date, options.timeZone);
  return blocks.map((block, index) => ({
    text: block,
    at: base ? new Date(base.getTime() + index * 60_000) : null,
    timeApprox: Boolean(base),
  }));
}

function parsePostPage(response: string, date: string | null | undefined, timeZone?: string | null): MomentPost[] | null {
  const parsed = extractJsonObject(response);
  if (!parsed || !Array.isArray(parsed.posts)) return null;
  const base = baseForDate(date, timeZone);
  const posts: MomentPost[] = [];
  for (const item of parsed.posts) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const text = typeof row.text === "string" ? row.text.trim() : "";
    if (!text) continue;
    const at =
      parseTimeBar(typeof row.time === "string" ? row.time : "", date, timeZone) ??
      null;
    posts.push({
      text,
      at: at ?? (base ? new Date(base.getTime() + posts.length * 60_000) : null),
      timeApprox: !at && Boolean(base),
    });
  }
  return posts;
}

/** Reads the posts out of screenshots of a feed, one picture at a time. */
export async function readMomentScreenshots(params: {
  images: ScreenshotImage[];
  provider: LLMProvider;
  name: string;
  date?: string | null;
  timeZone?: string | null;
  locale: Locale;
}): Promise<{ posts: MomentPost[]; failures: MomentReadFailure[] }> {
  const posts: MomentPost[] = [];
  const failures: MomentReadFailure[] = [];
  for (const [index, image] of params.images.slice(0, 30).entries()) {
    const text = [
      copy(params.locale, "vision.momentsPrompt", { name: params.name }),
      copy(params.locale, "vision.momentsShape"),
    ].join("\n\n");
    const dataUrl = image.base64.startsWith("data:")
      ? image.base64
      : `data:image/jpeg;base64,${image.base64}`;
    try {
      const response = await llmService.invokeWithProvider(params.provider, {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text },
              { type: "image_url", url: dataUrl },
            ],
          },
        ],
        options: { purpose: "extract", temperature: 0, maxTokens: 4000 },
      });
      const page = parsePostPage(response, params.date, params.timeZone);
      if (!page || page.length === 0) {
        failures.push({ index, message: copy(params.locale, "vision.momentsUnreadable") });
        continue;
      }
      posts.push(...page);
    } catch {
      failures.push({ index, message: copy(params.locale, "vision.momentsUnreadable") });
    }
  }
  // A post that appears on two overlapping screenshots is one post.
  const seen = new Set<string>();
  return {
    posts: posts.filter((post) => {
      const key = post.text.trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
    failures,
  };
}

/**
 * Turns the reviewed posts into rows for the record table.
 *
 * They are always the persona's own words in the public register. A
 * post with no time keeps `at` empty rather than pretending.
 */
export function momentPostsToRecords(
  posts: Array<{ text: string; at: string | null }>,
): Array<ParsedRecord & { role: RecordRole }> {
  return posts.map((post, index) => ({
    role: "assistant",
    speaker: "them",
    content: post.text,
    timestamp: post.at ? new Date(post.at) : null,
    kind: "text",
    meta: { register: "public" },
    lineNo: index + 1,
  }));
}
