import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The reconstructed line never gets out (C6.5).
 *
 * "Let the persona try to finish it" writes a sentence the real person
 * never said. It is for the user's eyes only, so the server side of it
 * has no route to the exit list, a channel, mail or a stored message —
 * and the client side of it has no copy or share button.
 *
 * A structural check because this is a promise about what the code will
 * never do, not about what one test run happens to do.
 */
const ROOT = path.resolve(__dirname, "../..");
const SERVER_FILES = [
  "server/records/unsaid.ts",
  "server/chat/unsaid.ts",
  "server/routers-v6/unsaid.ts",
];
const CLIENT_FILE = "client/src/components/v6/UnfinishedWords.tsx";

function read(relative: string): string {
  return readFileSync(path.join(ROOT, relative), "utf8");
}

describe("the unfinished line cannot leave the app", () => {
  it("has no exit, channel, mail or message write on the server side", () => {
    const forbidden = [
      /from\s+["'][^"']*chat\/outbound[^"']*["']/,
      /from\s+["'][^"']*channels[^"']*["']/,
      /from\s+["'][^"']*_core\/mail[^"']*["']/,
      /from\s+["'][^"']*_core\/push[^"']*["']/,
      /\bcreateMessage\s*\(/,
      /\bcreateOutboundLetter\s*\(/,
      /\bpushToUser\s*\(/,
    ];
    const offenders = SERVER_FILES.filter((file) => {
      const source = read(file);
      return forbidden.some((pattern) => pattern.test(source));
    });
    expect(offenders).toEqual([]);
  });

  it("has no copy or share control on the client side", () => {
    const source = read(CLIENT_FILE);
    expect(source).not.toMatch(/navigator\.clipboard/);
    expect(source).not.toMatch(/\bShare[0-9]?\b/);
    expect(source).not.toMatch(/unsaid\.(copy|share)/);
    expect(source).not.toMatch(/outbound\./);
  });
});
