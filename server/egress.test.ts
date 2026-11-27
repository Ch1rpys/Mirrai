import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { EGRESS_ITEMS } from "@shared/egress";

const ROOT = join(__dirname, "..");
const SERVER = join(ROOT, "server");

const CALL_PATTERN = /fetch\s*\(|new WebSocket\s*\(|https\.request\s*\(|http\.request\s*\(|nodemailer\.createTransport\s*\(|createTransport\s*\(|net\.connect\s*\(|tls\.connect\s*\(/;

/**
 * Production files under `server/` that talk to the network.
 *
 * Tests that `fetch` a local listener are not outbound. They are skipped
 * by name (`*.test.ts`).
 */
const CALL_SITES: Array<{ file: string; purpose: string }> = [
  { file: "server/llm/providers/openai.ts", purpose: "OpenAI-compatible chat and speech-to-text" },
  { file: "server/_core/stt.ts", purpose: "A local OpenAI-compatible speech-to-text service (STT_HTTP_URL)" },
  { file: "server/_core/tts.ts", purpose: "A local OpenAI-compatible speech endpoint (TTS_HTTP_URL)" },
  { file: "server/llm/providers/claude.ts", purpose: "Anthropic Messages API" },
  { file: "server/llm/providers/ollama.ts", purpose: "Ollama /api/chat" },
  { file: "server/chat/embeddings.ts", purpose: "Ollama /api/embed for local exemplar retrieval" },
  { file: "server/llm/providers/dify.ts", purpose: "Dify /chat-messages" },
  { file: "server/llm/providers/xunfei.ts", purpose: "iFlytek Spark WebSocket" },
  { file: "server/wechat/ilink/client.ts", purpose: "WeChat iLink HTTP" },
  { file: "server/routers-v6/ldr.ts", purpose: "Open-Meteo geocoding and forecast (C5.2)" },
  { file: "server/_core/mail.ts", purpose: "The user's own SMTP server for letter replies (C5.5)" },
  { file: "server/backup/targets.ts", purpose: "The user's own WebDAV or S3-compatible backup destination (C8.3)" },
  { file: "server/channels/telegram.ts", purpose: "The Telegram Bot API, long polling and sends (C9.1)" },
  { file: "server/channels/discord.ts", purpose: "The Discord Gateway and REST API (C9.1)" },
  { file: "server/channels/matrix.ts", purpose: "The user's own Matrix homeserver (C9.1)" },
];

function walk(dir: string, files: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === "drizzle") continue;
    const full = join(dir, name);
    const stats = statSync(full);
    if (stats.isDirectory()) walk(full, files);
    else if (/\.(ts|tsx|js|mjs|mts|cts)$/.test(name) && !/\.(test|spec)\.(ts|tsx|mts|cts)$/.test(name)) {
      files.push(full);
    }
  }
  return files;
}

function listedFiles(): Set<string> {
  return new Set(CALL_SITES.map((row) => row.file));
}

function filesWithCalls(): string[] {
  const hits: string[] = [];
  for (const full of walk(SERVER)) {
    const source = readFileSync(full, "utf8");
    if (!CALL_PATTERN.test(source)) continue;
    hits.push(relative(ROOT, full).replaceAll("\\", "/"));
  }
  return hits.sort();
}

function unlistedCallSites(
  files: Array<{ file: string; source: string }>,
  listed: Set<string>,
): string[] {
  return files
    .filter((file) => CALL_PATTERN.test(file.source) && !listed.has(file.file))
    .map((file) => file.file)
    .sort();
}

describe("the outbound inventory", () => {
  it("lists every fetch, WebSocket and http(s).request under server/", () => {
    const missing = unlistedCallSites(
      filesWithCalls().map((file) => ({ file, source: readFileSync(join(ROOT, file), "utf8") })),
      listedFiles(),
    );
    expect(missing).toEqual([]);
  });

  it("does not list a file that no longer talks to the network", () => {
    const present = new Set(filesWithCalls());
    const stale = CALL_SITES.map((row) => row.file).filter((file) => !present.has(file));
    expect(stale).toEqual([]);
  });

  it("fails when a new unlisted fetch appears", () => {
    const files = filesWithCalls().map((file) => ({
      file,
      source: readFileSync(join(ROOT, file), "utf8"),
    }));
    files.push({ file: "server/invented-egress.ts", source: 'fetch("https://example.com")' });
    expect(unlistedCallSites(files, listedFiles())).toEqual(["server/invented-egress.ts"]);
  });

  it("fails when a new unlisted socket appears", () => {
    const files = filesWithCalls().map((file) => ({
      file,
      source: readFileSync(join(ROOT, file), "utf8"),
    }));
    files.push({
      file: "server/invented-socket.ts",
      source: 'net.connect({ host: "example.com", port: 25 })',
    });
    files.push({
      file: "server/invented-tls.ts",
      source: 'tls.connect({ host: "example.com", port: 465 })',
    });
    expect(unlistedCallSites(files, listedFiles())).toEqual([
      "server/invented-socket.ts",
      "server/invented-tls.ts",
    ]);
  });

  it("keeps the markdown table in lockstep with the inventory", () => {
    // The document, the settings panel and this guard read the same array.
    // A row that drifts (an address that moved, a payload that grew) makes
    // the promise the settings page shows different from the one the
    // document makes, so every cell is compared, not just the id.
    const docs = readFileSync(join(ROOT, "docs/egress.md"), "utf8");
    const lines = docs.split("\n");
    const start = lines.findIndex((line) => line.startsWith("| id |"));
    expect(start, "docs/egress.md must contain the table header").toBeGreaterThanOrEqual(0);

    // One table, not two: every row must follow the header contiguously.
    let end = start;
    while (end < lines.length && lines[end].startsWith("|")) end += 1;
    // Header, the `---` separator, then one row per item: a blank line in
    // the middle would end the block early.
    expect(end - start).toBe(EGRESS_ITEMS.length + 2);

    const rows = new Map<string, string[]>();
    for (const line of lines.slice(start + 1, end)) {
      if (/^\|\s*-+/.test(line)) continue;
      const cells = line
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.trim());
      rows.set(cells[0], cells);
    }
    expect([...rows.keys()].sort()).toEqual(EGRESS_ITEMS.map((item) => item.id).sort());
    for (const item of EGRESS_ITEMS) {
      expect(rows.get(item.id)).toEqual([
        item.id,
        item.destination.zh,
        item.payload.zh,
        item.when.zh,
        item.defaultOn ? "开" : "关",
        item.offHow.zh,
        item.side,
      ]);
    }
  });
});
