/**
 * Reading a chat out of screenshots (B7.11).
 *
 * A screenshot is a picture, so a model that can see is required. The
 * prompt is explicit that the words in the picture are data — a
 * screenshot can contain anything, including something that looks like
 * an instruction — and that every bubble is transcribed verbatim.
 *
 * Nothing is written here. The result goes to the review step, where
 * the user changes whatever the model got wrong.
 */
import { copy } from "@shared/copy";
import type { LLMProvider } from "../llm/types";
import { llmService } from "../llm";
import { extractJsonObject } from "../_core/json";
import type { ScreenshotMessage } from "./screenshot-merge";
import type { Locale } from "@shared/copy";

export interface ScreenshotImage {
  name: string;
  /** A data URL or a bare base64 string. */
  base64: string;
}

export interface ScreenshotReadFailure {
  index: number;
  message: string;
}

export interface ScreenshotReadResult {
  pages: ScreenshotMessage[][];
  failures: ScreenshotReadFailure[];
}

const MAX_SCREENSHOTS = 30;

function mimeOf(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

function dataUrlOf(image: ScreenshotImage): string {
  return image.base64.startsWith("data:") ? image.base64 : `data:${mimeOf(image.name)};base64,${image.base64}`;
}

function sideOf(value: unknown): ScreenshotMessage["side"] | null {
  return value === "left" || value === "right" || value === "center" ? value : null;
}

function parsePage(response: string): ScreenshotMessage[] | null {
  const parsed = extractJsonObject(response);
  if (!parsed || !Array.isArray(parsed.messages)) return null;
  const messages: ScreenshotMessage[] = [];
  for (const item of parsed.messages) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const side = sideOf(row.side);
    if (!side) continue;
    messages.push({
      side,
      text: typeof row.text === "string" ? row.text : "",
      ...(typeof row.kind === "string" ? { kind: row.kind } : {}),
      ...(typeof row.time === "string" ? { time: row.time } : {}),
      ...(row.unclear === true ? { unclear: true } : {}),
    });
  }
  return messages;
}

/**
 * Sends each screenshot to the vision model, one at a time.
 *
 * One page that fails does not stop the rest: the user sees which ones
 * need to be retried, rather than losing the batch.
 */
export async function readScreenshotPages(params: {
  images: ScreenshotImage[];
  provider: LLMProvider;
  name: string;
  locale: Locale;
}): Promise<ScreenshotReadResult> {
  const pages: ScreenshotMessage[][] = [];
  const failures: ScreenshotReadFailure[] = [];
  for (const [index, image] of params.images.slice(0, MAX_SCREENSHOTS).entries()) {
    const text = [
      copy(params.locale, "vision.screenshotPrompt", { name: params.name }),
      copy(params.locale, "vision.screenshotShape"),
    ].join("\n\n");
    try {
      const response = await llmService.invokeWithProvider(params.provider, {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text },
              { type: "image_url", url: dataUrlOf(image) },
            ],
          },
        ],
        options: { purpose: "extract", temperature: 0, maxTokens: 4000 },
      });
      const messages = parsePage(response);
      if (!messages || messages.length === 0) {
        failures.push({
          index,
          message: copy(params.locale, "vision.screenshotUnreadable"),
        });
        continue;
      }
      pages.push(messages);
    } catch {
      failures.push({
        index,
        message: copy(params.locale, "vision.screenshotUnreadable"),
      });
    }
  }
  return { pages, failures };
}
