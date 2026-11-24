/**
 * The read-only MCP server (C9.3).
 *
 * It runs inside the user's own AI client, over standard input/output —
 * no port, no network. Every tool reads as the account the key belongs
 * to, through `server/db.ts`; nothing here writes. The point is that the
 * assistant on the other side can look at what the user uploaded without
 * the records being copied anywhere else by the app itself.
 *
 * **What the client does with this is the user's decision.** The client
 * sends what it reads to its own model. `docs/mcp.md` says so plainly.
 *
 * The records are quoted material: every result starts with a line
 * saying so, so a model that treats text as instructions has been told,
 * in its own conversation, what this text is.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { copy } from "@shared/copy";
import { normalizePersonaData } from "../_core/persona-schema";
import { normalizePersonaSettings } from "@shared/persona-settings";
import { isEncryptionLocked } from "../encryption/lock";
import type { RecordReport } from "../records/report";
import * as db from "../db";
import type { McpIdentity } from "./identity";

/** The most rows one record search may return. */
export const MCP_SEARCH_LIMIT = 30;
/** The most lines on either side of a record. */
export const MCP_CONTEXT_LINES = 10;

/**
 * Whether this persona is locked in the app (C8.4).
 *
 * A locked persona is hidden until its owner enters the PIN; the read-only
 * server has no PIN and no session, so it must not read it — the same rule
 * the OpenAI-compatible endpoint follows (C9.2). This is not the whole-app
 * lock, which deliberately does not cover keys (a key is the credential).
 */
function isLockedPersona(persona: { settings?: unknown } | null | undefined): boolean {
  return normalizePersonaSettings(persona?.settings).locked === true;
}

/** The sentence a tool answers a locked persona with, instead of its content. */
function lockedPersonaText(identity: McpIdentity): string {
  return copy(identity.locale, "mcp.lockedPersona");
}

type ToolResult = { content: Array<{ type: "text"; text: string }> };

function result(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

/** Every tool's answer opens with this, in the user's language. */
function withHeader(text: string, identity: McpIdentity): string {
  return `${copy(identity.locale, "mcp.recordHeader")}\n\n${text}`;
}

function roleName(role: string, identity: McpIdentity): string {
  if (role === "assistant") return copy(identity.locale, "mcp.roleThem");
  if (role === "user") return copy(identity.locale, "mcp.roleMe");
  return role;
}

function stamp(value: Date | string | null | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toISOString().slice(0, 16).replace("T", " ");
}

/**
 * The line under a record.
 *
 * It is a quote with a date, not a JSON object: the client's model reads
 * sentences better, and a person looking over its shoulder can tell what
 * was said and when.
 */
function recordLine(row: {
  timestamp: Date | null;
  role: string;
  content: string;
  speaker?: string | null;
}, identity: McpIdentity): string {
  // A quote line, not prose: the date, who said it and what was said.
  const speaker = row.speaker ? String(row.speaker) : roleName(row.role, identity);
  return `[${stamp(row.timestamp)}] ${speaker}: ${row.content}`;
}

function reportText(report: unknown, identity: McpIdentity): string {
  const data = report as RecordReport | null;
  if (!data || typeof data !== "object") return copy(identity.locale, "mcp.noReport");
  const lines: string[] = [];
  const span = data.span;
  if (span) {
    lines.push(copy(identity.locale, "mcp.reportSpan", {
      from: span.from,
      to: span.to,
      days: span.days,
      activeDays: span.activeDays,
    }));
  }
  if (data.totals) {
    lines.push(copy(identity.locale, "mcp.reportTotals", {
      them: data.totals.them,
      me: data.totals.me,
    }));
  }
  if (data.longestSilence) {
    lines.push(copy(identity.locale, "mcp.reportSilence", {
      days: data.longestSilence.days,
      from: data.longestSilence.from,
      to: data.longestSilence.to,
    }));
  }
  if (data.longestScene) {
    lines.push(copy(identity.locale, "mcp.reportScene", {
      minutes: data.longestScene.minutes,
      count: data.longestScene.count,
    }));
  }
  if (Array.isArray(data.byYear) && data.byYear.length > 0) {
    lines.push(copy(identity.locale, "mcp.reportYears", {
      years: data.byYear
        .map((year) => year.year)
        .join(", "),
    }));
  }
  return lines.join("\n");
}

/** The key's own sentence when the account's encrypted content is locked. */
async function locked(identity: McpIdentity): Promise<ToolResult | null> {
  if (!(await isEncryptionLocked(identity.userId))) return null;
  return result(copy(identity.locale, "mcp.encryptionLocked"));
}

/**
 * Registers the read-only tools on a server for one account.
 *
 * The server is created for the process's lifetime; the tools read the
 * database on every call, so a record imported while the client is open
 * is visible the next time it asks.
 */
export function createMirraiMcpServer(identity: McpIdentity): McpServer {
  const server = new McpServer({ name: "mirrai", version: "1.0.0" });

  server.registerTool(
    "list_personas",
    {
      description: "List the personas this account has, with their ids.",
      inputSchema: {},
    },
    async () => {
      const gate = await locked(identity);
      if (gate) return gate;
      const personas = (await db.getPersonasByUserId(identity.userId)).filter(
        (persona) => !isLockedPersona(persona),
      );
      if (personas.length === 0) {
        return result(withHeader(copy(identity.locale, "mcp.noPersonas"), identity));
      }
      const lines = personas.map((persona) => {
        const desc = (persona as { relationshipDesc?: string | null }).relationshipDesc;
        return desc
          ? `id=${persona.id} ${persona.name} (${desc})`
          : `id=${persona.id} ${persona.name}`;
      });
      return result(withHeader(lines.join("\n"), identity));
    },
  );

  server.registerTool(
    "read_persona",
    {
      description:
        "Read one persona's written portrait and the rules the owner has confirmed.",
      inputSchema: {
        personaId: z.number().int().positive(),
      },
    },
    async ({ personaId }) => {
      const gate = await locked(identity);
      if (gate) return gate;
      const persona = await db.getPersonaById(personaId, identity.userId);
      if (!persona) return result(withHeader(copy(identity.locale, "mcp.noPersona"), identity));
      if (isLockedPersona(persona)) {
        return result(withHeader(lockedPersonaText(identity), identity));
      }
      const data = normalizePersonaData(persona.personaData as Record<string, unknown> | null, {
        name: persona.name,
        locale: identity.locale,
      });
      const lines: string[] = [
        copy(identity.locale, "mcp.fieldName", { value: persona.name }),
      ];
      const desc = (persona as { relationshipDesc?: string | null }).relationshipDesc;
      if (desc) {
        lines.push(copy(identity.locale, "mcp.fieldRelationship", { value: desc }));
      }
      const together = (persona as { togetherFrom?: string | null }).togetherFrom;
      if (together) {
        lines.push(copy(identity.locale, "mcp.fieldTogether", { value: together }));
      }
      if (data.personality) {
        lines.push(copy(identity.locale, "mcp.fieldPersonality", { value: data.personality }));
      }
      if (data.speakingStyle) {
        lines.push(copy(identity.locale, "mcp.fieldSpeakingStyle", { value: data.speakingStyle }));
      }
      if (data.nickname) {
        lines.push(copy(identity.locale, "mcp.fieldNickname", { value: data.nickname }));
      }
      if (data.catchphrases.length > 0) {
        lines.push(copy(identity.locale, "mcp.fieldCatchphrases", {
          value: data.catchphrases.join(", "),
        }));
      }
      if (data.memories) {
        lines.push(copy(identity.locale, "mcp.fieldMemories", { value: data.memories }));
      }
      const rules = (data.microRules ?? []).filter((rule) => rule.verified);
      if (rules.length > 0) {
        lines.push(copy(identity.locale, "mcp.confirmedRules"));
        for (const rule of rules) {
          lines.push(`- ${rule.trigger.join(", ")} → ${rule.meaning} / ${rule.rendering}`);
        }
      }
      return result(withHeader(lines.join("\n"), identity));
    },
  );

  server.registerTool(
    "search_records",
    {
      description:
        "Search the imported chat records literally. Returns at most 30 lines with their dates.",
      inputSchema: {
        personaId: z.number().int().positive(),
        query: z.string().min(1).max(200),
        role: z.enum(["user", "assistant", "all"]).optional(),
        /** Asking for more does not give more: thirty is the ceiling. */
        limit: z.number().int().min(1).max(100).optional(),
      },
    },
    async ({ personaId, query, role, limit }) => {
      const gate = await locked(identity);
      if (gate) return gate;
      const persona = await db.getPersonaById(personaId, identity.userId);
      if (!persona) return result(withHeader(copy(identity.locale, "mcp.noPersona"), identity));
      if (isLockedPersona(persona)) {
        return result(withHeader(lockedPersonaText(identity), identity));
      }
      const hits = await db.searchRecordsLexical(personaId, identity.userId, {
        q: query,
        role: role ?? "all",
        limit: Math.min(limit ?? MCP_SEARCH_LIMIT, MCP_SEARCH_LIMIT),
      });
      if (hits.length === 0) {
        return result(withHeader(copy(identity.locale, "mcp.emptySearch"), identity));
      }
      const lines = hits
        .slice(0, MCP_SEARCH_LIMIT)
        .map((hit) => recordLine(hit, identity));
      return result(withHeader(lines.join("\n"), identity));
    },
  );

  server.registerTool(
    "get_record_context",
    {
      description:
        "Read the lines around one record. At most ten before and ten after.",
      inputSchema: {
        recordId: z.number().int().positive(),
        before: z.number().int().min(0).max(100).optional(),
        after: z.number().int().min(0).max(100).optional(),
      },
    },
    async ({ recordId, before, after }) => {
      const gate = await locked(identity);
      if (gate) return gate;
      const context = await db.getRecordsAround(
        recordId,
        identity.userId,
        Math.min(before ?? MCP_CONTEXT_LINES, MCP_CONTEXT_LINES),
        Math.min(after ?? MCP_CONTEXT_LINES, MCP_CONTEXT_LINES),
      );
      if (!context.target) {
        return result(withHeader(copy(identity.locale, "mcp.noRecord"), identity));
      }
      const personaId = (context.target as { personaId?: number | null }).personaId;
      if (typeof personaId === "number") {
        const persona = await db.getPersonaById(personaId, identity.userId);
        if (isLockedPersona(persona)) {
          return result(withHeader(lockedPersonaText(identity), identity));
        }
      }
      const lines = [
        ...context.before.map((row) => recordLine(row, identity)),
        `→ ${recordLine(context.target, identity)}`,
        ...context.after.map((row) => recordLine(row, identity)),
      ];
      return result(withHeader(lines.join("\n"), identity));
    },
  );

  server.registerTool(
    "read_report",
    {
      description:
        "Read the numbers of the annual report that was generated for one persona.",
      inputSchema: {
        personaId: z.number().int().positive(),
      },
    },
    async ({ personaId }) => {
      const gate = await locked(identity);
      if (gate) return gate;
      const persona = await db.getPersonaById(personaId, identity.userId);
      if (!persona) return result(withHeader(copy(identity.locale, "mcp.noPersona"), identity));
      if (isLockedPersona(persona)) {
        return result(withHeader(lockedPersonaText(identity), identity));
      }
      const cached = await db.getRecordReportCache(personaId, identity.userId);
      if (!cached) return result(withHeader(copy(identity.locale, "mcp.noReport"), identity));
      return result(withHeader(reportText(cached.report, identity), identity));
    },
  );

  return server;
}
