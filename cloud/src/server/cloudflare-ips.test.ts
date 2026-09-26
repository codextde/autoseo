import { describe, expect, it } from "vitest";
import { isCloudflareIp } from "./cloudflare-ips";
import { clientIpFromHeaders } from "./http";

describe("isCloudflareIp", () => {
  it("matches Cloudflare edge addresses", () => {
    expect(isCloudflareIp("104.16.1.1")).toBe(true);
    expect(isCloudflareIp("::ffff:172.64.10.2")).toBe(true);
    expect(isCloudflareIp("2606:4700::6810:84e5")).toBe(true);
  });
  it("rejects everything else", () => {
    expect(isCloudflareIp("203.0.113.9")).toBe(false);
    expect(isCloudflareIp("2001:db8::1")).toBe(false);
    expect(isCloudflareIp("not-an-ip")).toBe(false);
    expect(isCloudflareIp(null)).toBe(false);
  });
});

describe("clientIpFromHeaders", () => {
  it("uses CF-Connecting-IP only when the peer is Cloudflare", () => {
    expect(clientIpFromHeaders(new Headers({ "x-real-ip": "104.16.1.1", "cf-connecting-ip": "198.51.100.7" }))).toBe("198.51.100.7");
  });
  it("ignores a forged CF-Connecting-IP from a direct connection", () => {
    expect(clientIpFromHeaders(new Headers({ "x-real-ip": "203.0.113.9", "cf-connecting-ip": "198.51.100.7" }))).toBe("203.0.113.9");
  });
  it("falls back to the right-most X-Forwarded-For hop", () => {
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": "10.0.0.1, 203.0.113.9" }))).toBe("203.0.113.9");
    expect(clientIpFromHeaders(new Headers())).toBeNull();
  });
});
