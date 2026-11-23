/**
 * The plugins this process loaded (C9.7).
 *
 * The list is read-only: a plugin is added by putting a folder in the
 * data directory and restarting with `MIRRAI_PLUGINS=on`. The settings
 * page shows what was loaded and the outbound addresses each plugin
 * declares — the person who put the code there should be able to see
 * what it says it talks to.
 */
import { protectedProcedure, router } from "../_core/trpc";
import { listLoadedPlugins, pluginsEnabled } from "../plugins";

export const pluginsRouter = router({
  /** What is loaded, and whether plugins are switched on at all. */
  list: protectedProcedure.query(() => {
    return {
      enabled: pluginsEnabled(),
      plugins: listLoadedPlugins().map((row) => ({
        name: row.name,
        version: row.version,
        kind: row.kind,
        id: row.id,
        egress: [...row.egress],
      })),
    };
  }),
});

export default pluginsRouter;
