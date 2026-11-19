import { execFile } from "node:child_process";

/**
 * Runs a local binary with an argument array.
 *
 * The third-party tools this app shells out to (ffmpeg, whisper.cpp,
 * piper) take file paths that came from an upload, and a version of
 * this that built a shell string would be command injection with the
 * user's file name as the payload. An argument array cannot be
 * re-parsed by a shell.
 *
 * Every call is bounded: a corrupt file can make ffmpeg spin, and a
 * subprocess that never exits holds its memory and its pipe for the
 * life of the server.
 */

/** How long a local tool may run before it is killed. */
export const BINARY_TIMEOUT_MS = 120_000;

export interface RunBinaryOptions {
  timeoutMs?: number;
  maxBuffer?: number;
  env?: NodeJS.ProcessEnv;
  /**
   * Text handed to the process on standard input.
   *
   * Piper reads what it should say from stdin, and putting the sentence
   * in the argument list would both leak it into the process list and
   * hit the argument-length limit on a long reply.
   */
  stdin?: string;
  /**
   * Resolve on a non-zero exit instead of rejecting.
   *
   * `ffmpeg -i <file>` is how a file is probed, and it answers with
   * exit code 1 after printing the stream information. That is not a
   * failure of the probe.
   */
  allowFailure?: boolean;
}

export interface RunBinaryResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

/** A process that could not be started, or that ran out of time. */
export class BinaryRunError extends Error {
  code: number | null;
  signal: string | null;
  killed: boolean;
  timedOut: boolean;
  stderr: string;

  constructor(message: string, details: {
    code?: number | null;
    signal?: string | null;
    killed?: boolean;
    timedOut?: boolean;
    stderr?: string;
  } = {}) {
    super(message);
    this.name = "BinaryRunError";
    this.code = details.code ?? null;
    this.signal = details.signal ?? null;
    this.killed = details.killed ?? false;
    this.timedOut = details.timedOut ?? false;
    this.stderr = details.stderr ?? "";
  }
}

export function runBinary(
  bin: string,
  args: string[],
  options: RunBinaryOptions = {},
): Promise<RunBinaryResult> {
  return new Promise((resolve, reject) => {
    const timeout = options.timeoutMs ?? BINARY_TIMEOUT_MS;
    const child = execFile(
      bin,
      args,
      {
        timeout,
        maxBuffer: options.maxBuffer ?? 8 * 1024 * 1024,
        env: options.env,
        /**
         * SIGKILL, not the default SIGTERM.
         *
         * ffmpeg installs handlers for SIGTERM/SIGINT to stop cleanly,
         * which is right at a terminal and wrong here: a decoder stuck
         * in a native loop ignores it, and the "timeout" becomes a
         * suggestion. SIGKILL cannot be handled.
         */
        killSignal: "SIGKILL",
      },
      (error, stdout, stderr) => {
        const out = String(stdout ?? "");
        const err = String(stderr ?? "");
        if (!error) {
          resolve({ stdout: out, stderr: err, code: 0 });
          return;
        }
        const failure = error as NodeJS.ErrnoException & {
          code?: number | string;
          killed?: boolean;
          signal?: string;
        };
        const numericCode = typeof failure.code === "number" ? failure.code : null;
        const timedOut = failure.killed === true && failure.signal === "SIGKILL";
        if (options.allowFailure && !timedOut && numericCode !== null) {
          resolve({ stdout: out, stderr: err, code: numericCode });
          return;
        }
        const reason = timedOut
          ? `it did not finish within ${Math.round(timeout / 1000)} seconds`
          : failure.message;
        reject(
          new BinaryRunError(`${bin} failed: ${reason}`, {
            code: numericCode,
            signal: failure.signal ?? null,
            killed: failure.killed === true,
            timedOut,
            stderr: err,
          }),
        );
      },
    );
    /**
     * A process that reads stdin never gets past its first read until
     * the write half is closed here. `execFile` leaves it open.
     */
    if (options.stdin !== undefined) {
      child.stdin?.end(options.stdin);
    }
  });
}
