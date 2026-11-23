/**
 * The smallest importer plugin (C9.7).
 *
 * Copy this directory into `<data dir>/plugins/` and start the app with
 * `MIRRAI_PLUGINS=on`. The app reads `index.mjs` from each plugin
 * directory once, at boot.
 *
 * A plugin runs inside the app's process and has the app's permissions;
 * only put code here that you have read. This example reads a text file
 * where every line is `speaker: message`, behind a first line reading
 * `ECHO-EXPORT`, and produces text records.
 */
export default {
  name: "echo-importer",
  version: "1.0.0",
  kind: "importer",
  // This example never connects to anything.
  egress: [],
  create() {
    return {
      // The loader registers this as `plugin:echo-importer:echo`.
      id: "echo",
      label: { zh: "回声记录（示例插件）", en: "Echo transcript (example plugin)" },
      source: "generic",
      detect(source) {
        return source.text.startsWith("ECHO-EXPORT") ? { id: "echo", confidence: 0.99 } : null;
      },
      async parse(source) {
        const lines = source.text.split(/\r?\n/);
        const records = [];
        const speakers = new Map();
        let skipped = 0;
        for (let i = 1; i < lines.length; i += 1) {
          const line = lines[i].trim();
          if (!line) {
            skipped += 1;
            continue;
          }
          const at = line.indexOf(":");
          if (at <= 0) {
            skipped += 1;
            continue;
          }
          const speaker = line.slice(0, at).trim();
          const content = line.slice(at + 1).trim();
          records.push({
            speaker,
            content,
            timestamp: null,
            kind: "text",
            lineNo: i + 1,
          });
          const row = speakers.get(speaker) ?? { name: speaker, count: 0 };
          row.count += 1;
          speakers.set(speaker, row);
        }
        return {
          records,
          speakers: [...speakers.values()],
          warnings: [],
          skipped,
        };
      },
    };
  },
};
