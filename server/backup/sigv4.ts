/**
 * AWS Signature Version 4, for the S3-compatible backup target (C8.3).
 *
 * The manual asks for a single PUT without pulling in the AWS SDK, so
 * the signing is here. The test pins it against the worked example in
 * the AWS documentation ("Signature Calculations for the Authorization
 * Header: Transferring Payload in a Single Chunk", GET object with a
 * Range header):
 * https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html
 *
 * Only what a single PUT/DELETE needs is implemented: no query-string
 * authentication, no chunked streaming signatures. A backup that does
 * not fit one request is refused by the caller, not split.
 */
import { createHash, createHmac } from "node:crypto";

export interface SigV4Request {
  method: string;
  /** The absolute URL being called. */
  url: string;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Hex SHA-256 of the request body; the empty hash for a bodyless request. */
  payloadHash: string;
  now: Date;
  /** Extra headers to sign besides host, x-amz-content-sha256 and x-amz-date. */
  headers?: Record<string, string>;
}

export interface SigV4Signing {
  signature: string;
  authorization: string;
  signedHeaders: string;
  canonicalRequest: string;
  stringToSign: string;
  /** Every header the request must carry, signed or not. */
  headers: Record<string, string>;
}

/** The SHA-256 of an empty body: what a GET or a DELETE signs. */
export const EMPTY_PAYLOAD_HASH =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

function sha256Hex(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value, "utf-8").digest();
}

/** `20130524T000000Z` — the timestamp SigV4 signs. */
export function amzDate(now: Date): string {
  const iso = now.toISOString(); // 2013-05-24T00:00:00.000Z
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
}

/** `20130524` — the day inside the credential scope. */
export function amzDateStamp(now: Date): string {
  return amzDate(now).slice(0, 8);
}

/**
 * Percent-encodes one path segment the way SigV4's canonical URI wants.
 *
 * `encodeURIComponent` leaves `!'()*` alone, and the signature algorithm
 * does not: those five are encoded by AWS's own URI encoder.
 */
export function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * The canonical URI for a URL path.
 *
 * `/` separates segments and is kept; every segment is encoded. S3
 * canonicalises an already-encoded path by leaving it as it is for
 * normal object keys, which is what the URLs this app builds contain.
 */
export function canonicalUri(pathname: string): string {
  const segments = pathname.split("/").map((segment) => encodeRfc3986(decodeURIComponent(segment)));
  const joined = segments.join("/");
  return joined.startsWith("/") ? joined : `/${joined}`;
}

function canonicalHeaderValue(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/**
 * Signs one request.
 *
 * The headers returned are the ones the request must send; the caller
 * adds the body. `Authorization` is the only credential in the request —
 * the secret key never leaves this function.
 */
export function signAwsRequest(request: SigV4Request): SigV4Signing {
  const url = new URL(request.url);
  const headers: Record<string, string> = {
    ...request.headers,
    host: url.host,
    "x-amz-content-sha256": request.payloadHash,
    "x-amz-date": amzDate(request.now),
  };

  const signedHeaderNames = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort();
  const lower: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) lower[name.toLowerCase()] = value;

  const canonicalHeaders = signedHeaderNames
    .map((name) => `${name}:${canonicalHeaderValue(lower[name])}\n`)
    .join("");
  const signedHeaders = signedHeaderNames.join(";");
  const canonicalRequest = [
    request.method.toUpperCase(),
    canonicalUri(url.pathname),
    url.search.replace(/^\?/, ""),
    canonicalHeaders,
    signedHeaders,
    request.payloadHash,
  ].join("\n");

  const dateStamp = amzDateStamp(request.now);
  const scope = `${dateStamp}/${request.region}/${request.service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate(request.now),
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = hmac(`AWS4${request.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, request.region);
  const kService = hmac(kRegion, request.service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf-8").digest("hex");

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${request.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const sent: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) sent[name] = value;
  sent.authorization = authorization;

  return { signature, authorization, signedHeaders, canonicalRequest, stringToSign, headers: sent };
}

/** The SHA-256 of a file, hex — what an S3 PUT signs. */
export function payloadHashOfBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
