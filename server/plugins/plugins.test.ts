/**
 * The local plugin loader (C9.7).
 *
 * A plugin is somebody's code running inside the app's process, so the
 * loader has to be strict about the shape it accepts, honest about the
 * one it rejects, and completely inert until `MIRRAI_PLUGINS=on`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import type { ChannelAdapter } from "../channels/types";
import type { Importer } from "../importers/types";
import {
  listLoadedPlugins,
  loadPlugins,
  pluginsEnabled,
  pluginsDirFor,
  resetLoadedPlugins,
} from "./index";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "mirrai-plugins-"));
  roots.push(root);
  return root;
}

function writePlugin(root: string, dir: string, body: string): string {
  const pluginDir = path.join(root, "plugins", dir);
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(path.join(pluginDir, "index.mjs"), body);
  return pluginDir;
}

const importerPlugin = `export default {
  name: "sample-importer",
  version: "0.2.0",
  kind: "importer",
  egress: ["https://records.example.com/upload"],
  create() {
    return {
      id: "sample",
      label: { zh: "样本格式", en: "Sample format" },
      source: "generic",
      detect(source) {
        return source.text.startsWith("SAMPLE-EXPORT") ? { id: "sample", confidence: 0.9 } : null;
      },
      async parse(source) {
        const rows = source.text.split("\\n").slice(1).filter(Boolean).map((line, index) => {
          const [speaker, ...rest] = line.split(": ");
          return { speaker, content: rest.join(": "), timestamp: null, kind: "text", lineNo: index + 2 };
        });
        return {
          records: rows,
          speakers: [{ name: "me", count: 1 }, { name: "them", count: 1 }],
          warnings: [],
          skipped: 0,
        };
      },
    };
  },
};`;

const channelPlugin = `export default {
  name: "demo-channel",
  version: "3.0.0",
  kind: "channel",
  create() {
    return {
      id: "demo",
      label: "Demo",
      requiresCredentials: false,
      async start() {},
      async stop() {},
      async status() { return { channel: "plugin:demo-channel:demo", connected: true, status: "ready" }; },
      async send() {},
      async setDefaultPersona() {},
    };
  },
};`;

beforeEach(() => {
  resetLoadedPlugins();
});

afterEach(() => {
  resetLoadedPlugins();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("the plugin switch", () => {
  it("is off unless MIRRAI_PLUGINS is exactly on", () => {
    expect(pluginsEnabled({})).toBe(false);
    expect(pluginsEnabled({ MIRRAI_PLUGINS: "" })).toBe(false);
    expect(pluginsEnabled({ MIRRAI_PLUGINS: "off" })).toBe(false);
    expect(pluginsEnabled({ MIRRAI_PLUGINS: "true" })).toBe(false);
    expect(pluginsEnabled({ MIRRAI_PLUGINS: "on" })).toBe(true);
    expect(pluginsEnabled({ MIRRAI_PLUGINS: " ON " })).toBe(true);
  });

  it("does not read the plugin directory when the switch is off", async () => {
    const root = makeRoot();
    writePlugin(root, "unused", importerPlugin);
    const readDir = vi.fn(() => []);
    const result = await loadPlugins({ env: {}, dataRoot: root, readDir });
    expect(readDir).not.toHaveBeenCalled();
    expect(result).toEqual({ loaded: [], failed: [] });
  });

  it("treats a missing plugin folder as nothing to load", async () => {
    const root = makeRoot();
    const result = await loadPlugins({ env: { MIRRAI_PLUGINS: "on" }, dataRoot: root });
    expect(result).toEqual({ loaded: [], failed: [] });
  });
});

describe("importer plugins", () => {
  it("registers a valid importer with the prefix and parses a sample", async () => {
    const root = makeRoot();
    writePlugin(root, "sample-importer", importerPlugin);
    const registered: Importer[] = [];
    const log = vi.fn();
    const result = await loadPlugins({
      env: { MIRRAI_PLUGINS: "on" },
      dataRoot: root,
      registerImporter: (importer) => {
        registered.push(importer);
        return true;
      },
      registerChannel: () => {},
      log,
    });

    expect(result.failed).toEqual([]);
    expect(result.loaded).toHaveLength(1);
    expect(result.loaded[0]).toMatchObject({
      name: "sample-importer",
      version: "0.2.0",
      kind: "importer",
      id: "plugin:sample-importer:sample",
      egress: ["https://records.example.com/upload"],
    });
    expect(listLoadedPlugins()).toHaveLength(1);
    expect(registered).toHaveLength(1);

    const importer = registered[0]!;
    const detected = importer.detect({
      fileName: "sample.txt",
      bytes: new TextEncoder().encode("SAMPLE-EXPORT\nme: 你好\nthem: 在的"),
      text: "SAMPLE-EXPORT\nme: 你好\nthem: 在的",
    });
    // The plugin's own detect says "sample"; the loader's wrapper turns
    // it into the id the registry actually holds.
    expect(detected).toEqual({ id: "plugin:sample-importer:sample", confidence: 0.9 });
    expect(
      importer.detect({
        fileName: "x.txt",
        bytes: new TextEncoder().encode("nope"),
        text: "nope",
      }),
    ).toBeNull();

    const parsed = await importer.parse(
      {
        fileName: "sample.txt",
        bytes: new Uint8Array(),
        text: "SAMPLE-EXPORT\nme: 你好\nthem: 在的",
      },
      {},
    );
    expect(parsed.records.map((row) => [row.speaker, row.content])).toEqual([
      ["me", "你好"],
      ["them", "在的"],
    ]);
    expect(log).toHaveBeenCalledWith(
      "[Plugins] Loaded sample-importer@0.2.0 (importer) as plugin:sample-importer:sample",
    );
  });

  it("registers into the real importer registry, not just an injected port", async () => {
    // The loader's own tests pass an injected `registerImporter`; this one
    // loads with the real default so "the plugin was registered" is a fact
    // about the app's registry (C9.7), not about a test double.
    const root = makeRoot();
    writePlugin(root, "registry-importer", importerPlugin.replaceAll("sample-importer", "registry-importer"));
    const result = await loadPlugins({ env: { MIRRAI_PLUGINS: "on" }, dataRoot: root });
    expect(result.failed).toEqual([]);
    const { IMPORTERS, importerById } = await import("../importers/registry");
    const id = "plugin:registry-importer:sample";
    try {
      const importer = importerById(id);
      expect(importer).toBeDefined();
      expect(importer!.detect({
        fileName: "x.txt",
        bytes: new Uint8Array(),
        text: "SAMPLE-EXPORT\nme: 你好",
      })).toMatchObject({ id });
    } finally {
      const index = IMPORTERS.findIndex((row) => row.id === id);
      if (index >= 0) IMPORTERS.splice(index, 1);
    }
  });

  it("skips a plugin whose shape is wrong and says why in one line", async () => {
    const root = makeRoot();
    writePlugin(
      root,
      "broken-importer",
      `export default {
        name: "broken-importer",
        version: "1",
        kind: "importer",
        create() { return { id: "broken", label: { zh: "坏", en: "Broken" } }; },
      };`,
    );
    writePlugin(root, "fine", importerPlugin);
    const registered: Importer[] = [];
    const log = vi.fn();
    const result = await loadPlugins({
      env: { MIRRAI_PLUGINS: "on" },
      dataRoot: root,
      registerImporter: (importer) => {
        registered.push(importer);
        return true;
      },
      registerChannel: () => {},
      log,
    });

    // One broken plugin does not stop the others.
    expect(result.loaded).toHaveLength(1);
    expect(result.loaded[0]!.name).toBe("sample-importer");
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.dir).toBe(path.join(root, "plugins", "broken-importer"));
    expect(registered).toHaveLength(1);

    const skipLine = log.mock.calls
      .map((call) => String(call[0]))
      .find((line) => line.startsWith("[Plugins] Skipped broken-importer:"));
    expect(skipLine).toBeTruthy();
    // Readable: it names the missing field, and it is one line.
    expect(skipLine).toContain("detect");
    expect(skipLine).not.toContain("\n");
  });

  it("does not let a plugin take over a registered importer id", async () => {
    const root = makeRoot();
    writePlugin(root, "sample-importer", importerPlugin);
    const log = vi.fn();
    const result = await loadPlugins({
      env: { MIRRAI_PLUGINS: "on" },
      dataRoot: root,
      registerImporter: () => false,
      registerChannel: () => {},
      log,
    });
    expect(result.loaded).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.reason).toContain("already registered");
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("[Plugins] Skipped sample-importer:"),
    );
  });

  it("skips a directory whose module will not import", async () => {
    const root = makeRoot();
    mkdirSync(path.join(root, "plugins", "no-index"), { recursive: true });
    const log = vi.fn();
    const result = await loadPlugins({
      env: { MIRRAI_PLUGINS: "on" },
      dataRoot: root,
      registerImporter: () => true,
      registerChannel: () => {},
      log,
    });
    expect(result.loaded).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(log.mock.calls[0]![0]).toContain("[Plugins] Skipped no-index:");
  });
});

describe("channel plugins", () => {
  it("registers the adapter under the prefixed id", async () => {
    const root = makeRoot();
    writePlugin(root, "demo-channel", channelPlugin);
    const channels: ChannelAdapter[] = [];
    const result = await loadPlugins({
      env: { MIRRAI_PLUGINS: "on" },
      dataRoot: root,
      registerImporter: () => true,
      registerChannel: (adapter) => channels.push(adapter),
      log: () => {},
    });
    expect(result.failed).toEqual([]);
    expect(result.loaded[0]).toMatchObject({
      kind: "channel",
      id: "plugin:demo-channel:demo",
    });
    expect(channels).toHaveLength(1);
    expect(channels[0]!.id).toBe("plugin:demo-channel:demo");
    expect(channels[0]!.label).toBe("Demo");
  });
});

describe("the example plugin", () => {
  it("loads from examples/plugins and parses its sample format", async () => {
    expect(pluginsDirFor(path.join(repoRoot, "examples"))).toBe(
      path.join(repoRoot, "examples", "plugins"),
    );
    const registered: Importer[] = [];
    const result = await loadPlugins({
      env: { MIRRAI_PLUGINS: "on" },
      dataRoot: path.join(repoRoot, "examples"),
      registerImporter: (importer) => {
        registered.push(importer);
        return true;
      },
      registerChannel: () => {},
      log: () => {},
    });
    expect(result.failed).toEqual([]);
    expect(result.loaded).toHaveLength(1);
    expect(result.loaded[0]).toMatchObject({
      name: "echo-importer",
      kind: "importer",
      id: "plugin:echo-importer:echo",
    });
    expect(result.loaded[0]!.dir).toBe(
      path.join(repoRoot, "examples", "plugins", "echo-importer"),
    );
    const parsed = await registered[0]!.parse(
      {
        fileName: "echo.txt",
        bytes: new Uint8Array(),
        text: "ECHO-EXPORT\n阿树: 在吗\n小满: 在",
      },
      {},
    );
    expect(parsed.records.map((row) => row.content)).toEqual(["在吗", "在"]);
    expect(parsed.records.every((row) => row.kind === "text")).toBe(true);
  });
});
