/**
 * The installed plugins (C9.7).
 *
 * Two things matter here: the list says what is actually loaded in this
 * process, and it carries the outbound addresses each plugin declares.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { pluginsRouter } from "./plugins";
import { loadPlugins, resetLoadedPlugins } from "../plugins";

const ctx = { user: { id: 7, role: "user" }, locale: "zh" } as any;

function caller() {
  return pluginsRouter.createCaller(ctx);
}

const roots: string[] = [];

function pluginRoot(name: string, body: string): string {
  const root = mkdtempSync(path.join(tmpdir(), "mirrai-plugins-router-"));
  roots.push(root);
  const dir = path.join(root, "plugins", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "index.mjs"), body);
  return root;
}

afterEach(() => {
  resetLoadedPlugins();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("plugins.list", () => {
  it("reports plugins off and an empty list when the switch is off", async () => {
    const result = await caller().list();
    expect(result).toEqual({ enabled: false, plugins: [] });
  });

  it("lists a loaded plugin with the addresses it declares", async () => {
    resetLoadedPlugins();
    const previous = process.env.MIRRAI_PLUGINS;
    process.env.MIRRAI_PLUGINS = "on";
    try {
      const root = pluginRoot(
        "declared",
        `export default {
          name: "declared",
          version: "1.2.3",
          kind: "importer",
          egress: ["https://example.com/import"],
          create() { return {
            id: "declared",
            label: { zh: "声明", en: "Declared" },
            source: "generic",
            detect() { return null; },
            async parse() { return { records: [], speakers: [], warnings: [], skipped: 0 }; },
          }; },
        };`,
      );
      await loadPlugins({
        env: { MIRRAI_PLUGINS: "on" },
        dataRoot: root,
        readDir: () => [{ name: "declared", isDirectory: () => true }],
        importModule: async (url) => import(url),
        log: () => {},
        registerImporter: () => true,
      });
      const result = await caller().list();
      expect(result.enabled).toBe(true);
      expect(result.plugins).toEqual([
        {
          name: "declared",
          version: "1.2.3",
          kind: "importer",
          id: "plugin:declared:declared",
          egress: ["https://example.com/import"],
        },
      ]);
    } finally {
      if (previous === undefined) delete process.env.MIRRAI_PLUGINS;
      else process.env.MIRRAI_PLUGINS = previous;
    }
  });
});
