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
import { isIP } from "node:net";

/**
 * The hosts that mean "this machine, or a machine on the same LAN".
 *
 * The check is deliberately an IP-literal check. Matching the beginning
 * of the string (`/^127\./`) treats `127.0.0.1.evil.com` as loopback:
 * a public hostname that happens to start with a private-looking label.
 * If the host is not one of the named hosts, it has to parse as an IP
 * address before its octets are inspected.
 */
export function isLocalHostname(hostname: string): boolean {
  // `new URL("http://[::1]:8000").hostname` keeps the brackets.
  const host = hostname
    .toLowerCase()
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .replace(/\.$/, "");
  if (host === "localhost" || host === "::1") return true;
  if (isIP(host) !== 4) return false;

  const octets = host.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }
  const [first, second] = octets as [number, number, number, number];
  // 127.0.0.0/8
  if (first === 127) return true;
  // 10.0.0.0/8
  if (first === 10) return true;
  // 172.16.0.0/12
  if (first === 172 && second >= 16 && second <= 31) return true;
  // 192.168.0.0/16
  if (first === 192 && second === 168) return true;
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
        "The speech features only send to a local or private address.",
    );
  }
  return url;
}
