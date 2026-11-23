#!/usr/bin/env node
/**
 * The Mirrai MCP server (C9.3).
 *
 * Started by the user's own AI client as a child process and spoken to
 * over standard input/output — there is no port and no socket. The
 * account is `MIRRAI_API_KEY`, a read-scoped key from the app (C9.2).
 *
 * Nothing is written to standard output except the protocol: a stray
 * `console.log` corrupts the JSON-RPC stream, so every message for a
 * person goes to standard error.
 *
 * `docs/mcp.md` explains how to point a client at this.
 */
import "dotenv/config";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolveMcpIdentity, McpStartupError } from "../server/mcp/identity";
import { createMirraiMcpServer } from "../server/mcp/server";

async function main(): Promise<void> {
  const identity = await resolveMcpIdentity(process.env.MIRRAI_API_KEY);
  const server = createMirraiMcpServer(identity);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[mcp] Mirrai is ready, reading as user ${identity.userId}.`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[mcp] ${message}`);
  process.exit(error instanceof McpStartupError ? 2 : 1);
});
