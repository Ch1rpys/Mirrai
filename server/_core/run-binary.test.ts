import { describe, expect, it } from "vitest";
import { runBinary } from "./run-binary";

/**
 * The timeout is a promise to the server process.
 *
 * `ffmpeg.test.ts` asserts that the timeout options are passed to
 * `execFile` and that a SIGKILL-shaped error is mapped; that is not the
 * same as a child process actually being killed. This test starts a
 * real child (`node`) that would sleep for five seconds and checks that
 * `runBinary` comes back in about the timeout with `timedOut`.
 */
describe("the local binary runner", () => {
  it("kills a child process that runs past its timeout", async () => {
    const started = Date.now();
    await expect(
      runBinary(
        process.execPath,
        ["-e", "setTimeout(() => {}, 5000)"],
        { timeoutMs: 200 },
      ),
    ).rejects.toMatchObject({
      name: "BinaryRunError",
      timedOut: true,
      killed: true,
      signal: "SIGKILL",
    });
    // It must not have waited for the five-second child.
    expect(Date.now() - started).toBeLessThan(3000);
  }, 10_000);
});
