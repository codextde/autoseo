import { describe, expect, it } from "vitest";
import { destinationChanged, isDestinationField, normalizeDestination } from "./destination";

const wordpress = [
  { key: "siteUrl", type: "url" },
  { key: "username", type: "text" },
  { key: "appPassword", type: "password" },
];
const shopify = [
  { key: "shopDomain", type: "text" },
  { key: "accessToken", type: "password" },
  { key: "authorName", type: "text" },
];

describe("integration destination changes (stored secrets must not follow a new host)", () => {
  it("classifies destination fields", () => {
    expect(isDestinationField({ key: "siteUrl", type: "url" })).toBe(true);
    expect(isDestinationField({ key: "shopDomain", type: "text" })).toBe(true);
    expect(isDestinationField({ key: "url", type: "url" })).toBe(true);
    expect(isDestinationField({ key: "accountUrl", type: "text" })).toBe(true);
    expect(isDestinationField({ key: "username", type: "text" })).toBe(false);
    expect(isDestinationField({ key: "appPassword", type: "password" })).toBe(false);
  });

  it("detects a changed site URL / shop domain", () => {
    expect(destinationChanged(wordpress, { siteUrl: "https://attacker.example", username: "bob" }, { siteUrl: "https://blog.example.com" })).toBe(true);
    expect(destinationChanged(shopify, { shopDomain: "evil.myshopify.com" }, { shopDomain: "shop.myshopify.com" })).toBe(true);
    // port or path changes count as a new destination
    expect(destinationChanged(wordpress, { siteUrl: "https://blog.example.com:8443" }, { siteUrl: "https://blog.example.com" })).toBe(true);
    expect(destinationChanged(wordpress, { siteUrl: "https://blog.example.com/other" }, { siteUrl: "https://blog.example.com" })).toBe(true);
  });

  it("ignores cosmetic differences and blank (= keep) values", () => {
    expect(destinationChanged(wordpress, { siteUrl: "blog.example.com/" }, { siteUrl: "https://blog.example.com" })).toBe(false);
    expect(destinationChanged(wordpress, { siteUrl: "HTTPS://Blog.Example.com" }, { siteUrl: "https://blog.example.com" })).toBe(false);
    expect(destinationChanged(wordpress, { siteUrl: "", username: "new-user" }, { siteUrl: "https://blog.example.com" })).toBe(false);
    expect(destinationChanged(shopify, { authorName: "Me" }, { shopDomain: "shop.myshopify.com" })).toBe(false);
  });

  it("normalizes destinations", () => {
    expect(normalizeDestination("Example.com/")).toBe("https://example.com");
    expect(normalizeDestination("http://a.b:8080/x/")).toBe("http://a.b:8080/x");
  });
});
