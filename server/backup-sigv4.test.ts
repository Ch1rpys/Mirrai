import { describe, expect, it } from "vitest";
import {
  EMPTY_PAYLOAD_HASH,
  amzDate,
  canonicalUri,
  encodeRfc3986,
  signAwsRequest,
} from "./backup/sigv4";

/**
 * The signing is pinned to the worked example in the AWS documentation
 * for a single-chunk header-based signature (GET object with a Range
 * header):
 * https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html
 *
 * Credentials are the documentation's own example pair, never real.
 */
describe("SigV4", () => {
  it("reproduces the AWS documentation's GET-object signature", () => {
    const signed = signAwsRequest({
      method: "GET",
      url: "https://examplebucket.s3.amazonaws.com/test.txt",
      region: "us-east-1",
      service: "s3",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      payloadHash: EMPTY_PAYLOAD_HASH,
      now: new Date("2013-05-24T00:00:00Z"),
      headers: { range: "bytes=0-9" },
    });
    expect(signed.signature).toBe(
      "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
    expect(signed.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, " +
        "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, " +
        "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
    expect(signed.headers["x-amz-date"]).toBe("20130524T000000Z");
  });

  it("prints the shared date format", () => {
    expect(amzDate(new Date("2026-01-02T03:04:05Z"))).toBe("20260102T030405Z");
  });

  it("encodes the five characters encodeURIComponent leaves alone", () => {
    expect(encodeRfc3986("a!b'c(d)e*f")).toBe("a%21b%27c%28d%29e%2Af");
    expect(canonicalUri("/mirrai/x y.zip")).toBe("/mirrai/x%20y.zip");
    expect(canonicalUri("/")).toBe("/");
  });
});
