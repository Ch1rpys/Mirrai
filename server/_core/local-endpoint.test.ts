import { describe, expect, it } from "vitest";
import { assertLocalEndpoint, isLocalEndpoint } from "./local-endpoint";

describe("the local endpoint guard", () => {
  it("calls loopback and private addresses local", () => {
    expect(isLocalEndpoint("http://127.0.0.1:8000/v1/audio/transcriptions")).toBe(true);
    expect(isLocalEndpoint("http://localhost:8080/v1")).toBe(true);
    expect(isLocalEndpoint("http://[::1]:8000/v1")).toBe(true);
    expect(isLocalEndpoint("http://10.0.0.5:8000")).toBe(true);
    expect(isLocalEndpoint("http://172.16.3.4:8000")).toBe(true);
    expect(isLocalEndpoint("http://172.31.255.1:8000")).toBe(true);
    expect(isLocalEndpoint("http://192.168.1.20:8000")).toBe(true);
  });

  it("does not call a public or neighbouring address local", () => {
    expect(isLocalEndpoint("https://api.openai.com/v1")).toBe(false);
    expect(isLocalEndpoint("http://8.8.8.8:8000")).toBe(false);
    expect(isLocalEndpoint("http://172.32.0.1:8000")).toBe(false);
    expect(isLocalEndpoint("http://11.0.0.1:8000")).toBe(false);
    expect(isLocalEndpoint("not a url")).toBe(false);
  });

  it("does not mistake a hostname that starts with a private label for an address", () => {
    // A domain is not an IP literal, even when its first label is a
    // private-looking number. `127.evil.com` can resolve anywhere.
    expect(isLocalEndpoint("http://127.evil.com:8000/v1")).toBe(false);
    expect(isLocalEndpoint("http://127.0.0.1.evil.com:8000/v1")).toBe(false);
    expect(isLocalEndpoint("http://10.evil.com:8000/v1")).toBe(false);
    expect(isLocalEndpoint("http://192.168.evil.com:8000/v1")).toBe(false);
    expect(isLocalEndpoint("http://172.16.evil.com:8000/v1")).toBe(false);
    expect(isLocalEndpoint("http://localhost.evil.com:8000/v1")).toBe(false);
  });

  it("refuses a public address unless remote is allowed", () => {
    expect(() => assertLocalEndpoint("https://speech.example.com/v1")).toThrow(
      /not on this machine/,
    );
    const parsed = assertLocalEndpoint("https://speech.example.com/v1", true);
    expect(parsed.hostname).toBe("speech.example.com");
  });

  it("refuses something that is not an http URL", () => {
    expect(() => assertLocalEndpoint("file:///etc/passwd")).toThrow(/http or https/);
    expect(() => assertLocalEndpoint("not a url")).toThrow(/not a URL/);
  });
});
