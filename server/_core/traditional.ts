/**
 * The traditional Chinese converter, registered with the copy table.
 *
 * The server's own words are written once, in simplified Chinese, and the
 * traditional interface reads them in traditional characters. The conversion
 * is the simplified → traditional OpenCC table, which is over a megabyte —
 * so it is imported here, on the server, and handed to `shared/copy` as a
 * function. `shared/copy` is imported by the client as well, and a top-level
 * import of this table there would put a megabyte into the browser bundle for
 * a language the client already carries as a generated dictionary.
 *
 * Imported for its side effect at server startup (`server/_core/index.ts`).
 * Tests that need `copy("zh-Hant", …)` register the same converter
 * themselves, so they do not depend on the server entry point.
 */
import { Converter } from "opencc-js/cn2t";
import { registerTraditionalConverter } from "@shared/copy";

registerTraditionalConverter(Converter({ from: "cn", to: "tw" }));
