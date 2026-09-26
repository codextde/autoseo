import { describe, expect, it } from "vitest";
import { BOT_UA_PATTERN, identifyBot, isKnownBot } from "./bot-classifier";
import { compileCidrs, ipInCidr, ipInCidrs, ipInCompiled, parseIp } from "./cidr";

describe("identifyBot", () => {
  const cases: [string, string | null][] = [
    ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)", "GPTBot"],
    ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot", "ChatGPT-User"],
    ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot", "OAI-SearchBot"],
    ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)", "ClaudeBot"],
    ["Mozilla/5.0 (compatible; Claude-User/1.0; +Claude-User@anthropic.com)", "Claude-User"],
    ["Mozilla/5.0 (compatible; Claude-SearchBot/1.0)", "Claude-SearchBot"],
    ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)", "PerplexityBot"],
    ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)", "Perplexity-User"],
    ["Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", "Googlebot"],
    ["Mozilla/5.0 (compatible; GoogleOther)", "GoogleOther"],
    ["Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)", "Bingbot"],
    ["Mozilla/5.0 (Macintosh) Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)", "Applebot"],
    ["Applebot-Extended/1.0", "Applebot-Extended"],
    ["meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)", "meta-externalagent"],
    ["Mozilla/5.0 (compatible; Bytespider; spider-feedback@bytedance.com)", "Bytespider"],
    ["CCBot/2.0 (https://commoncrawl.org/faq/)", "CCBot"],
    ["Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)", "SemrushBot"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36", null],
    ["", null],
  ];
  it.each(cases)("%s → %s", (ua, expected) => {
    expect(identifyBot(ua)?.token ?? null).toBe(expected);
  });
  it("exposes the pattern for the worker", () => {
    expect(new RegExp(BOT_UA_PATTERN, "i").test("GPTBot")).toBe(true);
    expect(isKnownBot("Mozilla/5.0 Chrome")).toBe(false);
  });
});

describe("cidr", () => {
  it("parses IPv4, IPv6 and mapped addresses", () => {
    expect(parseIp("1.2.3.4")?.v).toBe(4);
    expect(parseIp("2001:db8::1")?.v).toBe(6);
    expect(parseIp("::ffff:1.2.3.4")).toEqual(parseIp("1.2.3.4"));
    expect(parseIp("::1")?.value).toBe(BigInt(1));
    expect(parseIp("999.1.1.1")).toBeNull();
    expect(parseIp("not-an-ip")).toBeNull();
    expect(parseIp("1:2:3:4:5:6:7:8:9")).toBeNull();
  });
  it("matches IPv4 ranges", () => {
    expect(ipInCidr("20.171.207.185", "20.171.207.0/24")).toBe(true);
    expect(ipInCidr("20.171.208.1", "20.171.207.0/24")).toBe(false);
    expect(ipInCidr("66.249.66.1", "66.249.64.0/19")).toBe(true);
    expect(ipInCidr("10.0.0.1", "0.0.0.0/0")).toBe(true);
    expect(ipInCidr("::ffff:66.249.66.1", "66.249.64.0/19")).toBe(true);
  });
  it("matches IPv6 ranges", () => {
    expect(ipInCidr("2001:4860:4801:10::1", "2001:4860:4801:10::/64")).toBe(true);
    expect(ipInCidr("2001:4860:4801:11::1", "2001:4860:4801:10::/64")).toBe(false);
    expect(ipInCidrs("2001:4860:4801:10::1", ["1.2.3.0/24", "2001:4860::/32"])).toBe(true);
  });
  it("never matches across families and ignores invalid ranges", () => {
    const ranges = compileCidrs(["1.2.3.0/24", "bogus", "2001:db8::/129"]);
    expect(ranges.length).toBe(1);
    expect(ipInCompiled("2001:db8::1", ranges)).toBe(false);
    expect(ipInCompiled(null, ranges)).toBe(false);
  });
});
