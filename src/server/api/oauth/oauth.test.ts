import { describe, expect, it } from "vitest";
import { isLoopbackHost, redirectUriMatches, validateRedirectUri } from "./clients";
import { normalizeResource } from "./metadata";
import { parseScopes } from "@/features/api-settings/scopes";

describe("OAuth redirect URI policy", () => {
  it("accepts https, loopback http and private-use schemes", () => {
    expect(validateRedirectUri("https://claude.ai/api/mcp/auth_callback")).toBeNull();
    expect(validateRedirectUri("http://127.0.0.1:33418/callback")).toBeNull();
    expect(validateRedirectUri("http://localhost:6274/oauth/callback")).toBeNull();
    expect(validateRedirectUri("http://[::1]:8080/cb")).toBeNull();
    expect(validateRedirectUri("cursor://anysphere.cursor-retrieval/oauth/callback")).toBeNull();
  });
  it("rejects dangerous or ambiguous URIs", () => {
    expect(validateRedirectUri("http://evil.example/cb")).toMatch(/loopback/);
    expect(validateRedirectUri("javascript:alert(1)")).toMatch(/not allowed/);
    expect(validateRedirectUri("data:text/html,x")).toMatch(/not allowed/);
    expect(validateRedirectUri("https://a.example/cb#frag")).toMatch(/fragment/);
    expect(validateRedirectUri("https://user:pw@a.example/cb")).toMatch(/credentials/);
    expect(validateRedirectUri("not a url")).toMatch(/absolute/);
  });
  it("matches exactly, except the port of loopback URIs", () => {
    expect(redirectUriMatches("https://a.example/cb", "https://a.example/cb")).toBe(true);
    expect(redirectUriMatches("https://a.example/cb", "https://a.example/cb2")).toBe(false);
    expect(redirectUriMatches("http://127.0.0.1:1000/cb", "http://127.0.0.1:2000/cb")).toBe(true);
    expect(redirectUriMatches("http://127.0.0.1:1000/cb", "http://127.0.0.1:2000/other")).toBe(false);
    expect(redirectUriMatches("https://a.example:1/cb", "https://a.example:2/cb")).toBe(false);
    expect(isLoopbackHost("127.0.0.5")).toBe(true);
    expect(isLoopbackHost("example.com")).toBe(false);
  });
  it("normalises resource indicators by path", () => {
    expect(normalizeResource("https://seo.example.com/api/mcp")).toEqual({ ok: true, value: "https://seo.example.com/api/mcp" });
    expect(normalizeResource("https://seo.example.com/api/mcp/")).toEqual({ ok: true, value: "https://seo.example.com/api/mcp" });
    expect(normalizeResource("https://seo.example.com")).toEqual({ ok: true, value: "https://seo.example.com" });
    expect(normalizeResource("https://seo.example.com/other")).toEqual({ ok: false });
    expect(normalizeResource(undefined)).toEqual({ ok: true, value: null });
  });
  it("parses scopes (read always implied)", () => {
    expect(parseScopes("write")).toEqual(["read", "write"]);
    expect(parseScopes("export, read bogus")).toEqual(["read", "export"]);
    expect(parseScopes(null)).toEqual(["read"]);
  });
});
