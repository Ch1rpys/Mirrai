/**
 * Whether an address stays on this machine.
 *
 * Two features can be pointed at a speech service the user runs
 * themselves: local transcription (B7.2) and local read-aloud (B7.6).
 * The whole point of running them locally is that the audio — and the
 * words — do not leave the machine. A URL typed into a settings field
 * can point anywhere, so it is checked: loopback and the private IPv4
 * ranges are "here", everything else is "out there".
 *
 * "Out there" is not forbidden — somebody may run a transcription box
 * on their own LAN or a server they control — but it has to be said
 * out loud, with a second environment variable, rather than happening
 * because a port number was mistyped.
 */

/** The hosts that mean "this machine, or a machine on the same LAN". */
export function isLocalHostname(hostname: string): boolean {
  // `new URL("http://[::1]:8000").hostname` keeps the brackets.
  const host = hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (host === "localhost" || host === "::1") return true;
  // 127.0.0.0/8
  if (/^127\./.test(host)) return true;
  // 10.0.0.0/8
  if (/^10\./.test(host)) return true;
  // 172.16.0.0/12
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  // 192.168.0.0/16
  if (/^192\.168\./.test(host)) return true;
  return false;
}

/** Whether a URL points at this machine (or the local network). */
export function isLocalEndpoint(rawUrl: string | URL): boolean {
  try {
    const url = typeof rawUrl === "string" ? new URL(rawUrl) : rawUrl;
    return isLocalHostname(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Checks a speech-service URL, and returns it parsed.
 *
 * Throws when the address is not local and the caller has not passed
 * `allowRemote`. The error names the address rather than the feature:
 * both features call this, and a message that says "STT" while the
 * user was configuring the read-aloud would be a small lie.
 */
export function assertLocalEndpoint(rawUrl: string, allowRemote = false): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`The speech service address is not a URL: ${rawUrl}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(
      `The speech service address must be http or https, not ${url.protocol}.`,
    );
  }
  if (!allowRemote && !isLocalHostname(url.hostname)) {
    throw new Error(
      `The speech service at ${url.hostname} is not on this machine. ` +
        "Set the allow-remote switch for this feature if you really mean to send the audio there.",
    );
  }
  return url;
}
