/**
 * Local importer and channel plugins (C9.7).
 *
 * The scope is deliberately small: a directory inside the app's data
 * folder, read once at boot, when `MIRRAI_PLUGINS=on`. There is no
 * remote install and no marketplace; a plugin is a file the person put
 * there themselves.
 *
 * A plugin runs **inside this process**, so it can do everything the app
 * can do — read the database, call the network, write files. That is why
 * the switch is off by default, why the settings page says so plainly,
 * and why only the declared egress addresses are shown: they are a
 * promise, not a fence.
 *
 * Each plugin is a directory `<data dir>/plugins/<dir>/index.mjs`
 * exporting:
 *
 *   { name, version, kind: "importer" | "channel", egress?: string[],
 *     create() }
 *
 * `create()` returns an object that satisfies the C1.1 importer shape or
 * the `ChannelAdapter` shape. The loader validates that shape before
 * anything is registered; one broken plugin is logged and skipped, and
 * the app starts without it.
 */
import { readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { registerChannel } from "../channels";
import type { ChannelAdapter } from "../channels/types";
import { registerImporter } from "../importers/registry";
import type { Importer } from "../importers/types";
import { resolveDataRoot } from "../bootstrap/bootstrap";

/** A plugin's own name; it becomes part of the registered id. */
const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,40}$/i;
/** The id a plugin gives its own importer or channel. */
const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,40}$/i;

export interface LoadedPlugin {
  /** The plugin's own name. */
  name: string;
  version: string;
  kind: "importer" | "channel";
  /** The id it was registered under: `plugin:<name>:<plugin id>`. */
  id: string;
  /**
   * The addresses the plugin declared it connects to.
   *
   * Shown in the settings page so a person can see what the code they
   * dropped in says it talks to. The app does not enforce the list.
   */
  egress: string[];
  /** The directory it was loaded from. */
  dir: string;
}

export interface PluginLoadResult {
  loaded: LoadedPlugin[];
  failed: Array<{ dir: string; reason: string }>;
}

export interface PluginLoadOptions {
  /** Defaults to `process.env`; read every time so a test (or a restart) can change it. */
  env?: NodeJS.ProcessEnv;
  /** Defaults to the app's data directory. */
  dataRoot?: string;
  readDir?: (dir: string) => Array<{ name: string; isDirectory: () => boolean }>;
  importModule?: (url: string) => Promise<unknown>;
  log?: (line: string) => void;
  registerImporter?: (importer: Importer) => boolean | void;
  registerChannel?: (adapter: ChannelAdapter) => void;
}

const loadedPlugins: LoadedPlugin[] = [];

/**
 * What was loaded in this process, for the settings page.
 *
 * A copy, so a caller cannot make the app believe a plugin is loaded.
 */
export function listLoadedPlugins(): LoadedPlugin[] {
  return loadedPlugins.map((row) => ({ ...row, egress: [...row.egress] }));
}

/** Clears the in-memory list. Only tests need this. */
export function resetLoadedPlugins(): void {
  loadedPlugins.length = 0;
}

/** Whether the operator asked for plugins at all. Off unless exactly "on". */
export function pluginsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.MIRRAI_PLUGINS ?? "").trim().toLowerCase() === "on";
}

/** The directory plugins are read from. */
export function pluginsDirFor(dataRoot: string): string {
  return path.join(dataRoot, "plugins");
}

const anyFunction = z.custom<(...args: never[]) => unknown>(
  (value) => typeof value === "function",
  { message: "must be a function" },
);

const pluginSchema = z.object({
  name: z.string().regex(NAME_PATTERN, "name must be letters, digits, dots, dashes or underscores"),
  version: z.string().min(1).max(40),
  kind: z.enum(["importer", "channel"]),
  egress: z.array(z.string().min(1).max(300)).max(50).optional(),
  create: anyFunction,
});

const importerSchema = z.object({
  id: z.string().regex(PLUGIN_ID_PATTERN, "importer id must be letters, digits, dots, dashes or underscores"),
  label: z.object({ zh: z.string().min(1), en: z.string().min(1) }),
  source: z.string().min(1).max(32),
  detect: anyFunction,
  parse: anyFunction,
});

const channelSchema = z.object({
  id: z.string().regex(PLUGIN_ID_PATTERN, "channel id must be letters, digits, dots, dashes or underscores"),
  label: z.string().min(1).max(100),
  requiresCredentials: z.boolean(),
  start: anyFunction,
  stop: anyFunction,
  status: anyFunction,
  send: anyFunction,
  setDefaultPersona: anyFunction,
}).passthrough();

/**
 * Reads the plugin directory once and registers what it finds.
 *
 * Never throws: a plugin that will not load is skipped, and the app is
 * not held hostage by a file somebody dropped in a folder.
 */
export async function loadPlugins(options: PluginLoadOptions = {}): Promise<PluginLoadResult> {
  const result: PluginLoadResult = { loaded: [], failed: [] };
  const env = options.env ?? process.env;
  if (!pluginsEnabled(env)) return result;

  const dataRoot = options.dataRoot ?? resolveDataRoot();
  const dir = pluginsDirFor(dataRoot);
  const readDir =
    options.readDir ?? ((target: string) => readdirSync(target, { withFileTypes: true }));
  const importModule = options.importModule ?? ((url: string) => import(url));
  const log = options.log ?? ((line: string) => console.log(line));
  const addImporter = options.registerImporter ?? registerImporter;
  const addChannel = options.registerChannel ?? registerChannel;

  let entries: Array<{ name: string; isDirectory: () => boolean }>;
  try {
    entries = readDir(dir);
  } catch (error) {
    // No plugins folder is the ordinary case, not a failure.
    const code = (error as { code?: string } | null)?.code;
    if (code !== "ENOENT") {
      const reason = error instanceof Error ? error.message : String(error);
      log(`[Plugins] Could not read ${dir}: ${reason}`);
      result.failed.push({ dir, reason });
    }
    return result;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pluginDir = path.join(dir, entry.name);
    const file = path.join(pluginDir, "index.mjs");
    try {
      const module = (await importModule(pathToFileURL(file).href)) as {
        default?: unknown;
      };
      const raw = (module as { default?: unknown }).default ?? module;
      const plugin = pluginSchema.parse(raw);
      const created = await plugin.create();
      const prefix = `plugin:${plugin.name}:`;

      if (plugin.kind === "importer") {
        const importer = importerSchema.parse(created);
        const id = `${prefix}${importer.id}` as Importer["id"];
        const registered = addImporter({
          id,
          label: { zh: importer.label.zh, en: importer.label.en },
          source: importer.source as Importer["source"],
          detect: (source) => {
            const found = (importer.detect as Importer["detect"])(source);
            // The plugin does not know its prefixed id; the loader adds it.
            return found ? { ...found, id } : null;
          },
          parse: (source, parseOptions) =>
            (importer.parse as Importer["parse"])(source, parseOptions),
        });
        if (registered === false) {
          throw new Error(`an importer with id ${id} is already registered`);
        }
        loadedPlugins.push({
          name: plugin.name,
          version: plugin.version,
          kind: plugin.kind,
          id,
          egress: plugin.egress ?? [],
          dir: pluginDir,
        });
        result.loaded.push(loadedPlugins[loadedPlugins.length - 1]!);
        log(`[Plugins] Loaded ${plugin.name}@${plugin.version} (importer) as ${id}`);
      } else {
        const adapter = channelSchema.parse(created);
        const id = `${prefix}${adapter.id}` as ChannelAdapter["id"];
        addChannel({ ...(created as object), id } as ChannelAdapter);
        loadedPlugins.push({
          name: plugin.name,
          version: plugin.version,
          kind: plugin.kind,
          id,
          egress: plugin.egress ?? [],
          dir: pluginDir,
        });
        result.loaded.push(loadedPlugins[loadedPlugins.length - 1]!);
        log(`[Plugins] Loaded ${plugin.name}@${plugin.version} (channel) as ${id}`);
      }
    } catch (error) {
      const reason = describePluginError(error);
      log(`[Plugins] Skipped ${entry.name}: ${reason}`);
      result.failed.push({ dir: pluginDir, reason });
    }
  }

  return result;
}

/**
 * One readable line for a plugin that will not load.
 *
 * Zod's own message is a pretty-printed JSON array — fine in a stack
 * trace, useless as a log line — so the issues are flattened into
 * `field: message` pairs.
 */
function describePluginError(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues
      .map((issue) => {
        const where = issue.path.length > 0 ? issue.path.join(".") : "shape";
        return `${where}: ${issue.message}`;
      })
      .join("; ");
  }
  return error instanceof Error ? error.message : String(error);
}
