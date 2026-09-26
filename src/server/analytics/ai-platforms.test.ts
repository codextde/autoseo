import { describe, expect, it } from "vitest";
import {
  AI_PLATFORMS,
  GA4_AI_SOURCE_REGEX,
  PIWIK_AI_SOURCE_REGEX,
  aiReferrerDomains,
  classifyAiSource,
  platformMonogram,
} from "./ai-platforms";

describe("classifyAiSource", () => {
  it.each([
    ["chatgpt.com", "chatgpt"],
    ["chat.openai.com", "chatgpt"],
    ["openai", "chatgpt"],
    ["ChatGPT", "chatgpt"],
    ["chatgpt.com / referral", "chatgpt"],
    ["perplexity.ai", "perplexity"],
    ["www.perplexity.ai", "perplexity"],
    ["labs.perplexity.ai", "perplexity"],
    ["perplexity", "perplexity"],
    ["gemini.google.com", "gemini"],
    ["bard.google.com", "gemini"],
    ["claude.ai", "claude"],
    ["copilot.microsoft.com", "copilot"],
    ["copilot.cloud.microsoft", "copilot"],
    ["edgeservices.bing.com", "copilot"],
    ["meta.ai", "meta_ai"],
    ["chat.deepseek.com", "deepseek"],
    ["deepseek", "deepseek"],
    ["grok.com", "grok"],
    ["x.ai", "grok"],
    ["chat.mistral.ai", "mistral"],
    ["mistral", "mistral"],
    ["you.com", "you"],
    ["phind.com", "phind"],
    ["poe.com", "poe"],
    ["duck.ai", "duck_ai"],
  ])("maps %s → %s", (source, expected) => {
    expect(classifyAiSource(source)).toBe(expected);
  });

  it("uses referrer URLs incl. paths", () => {
    expect(classifyAiSource(null, "https://www.bing.com/chat?q=best+shoes")).toBe("copilot");
    expect(classifyAiSource("(direct)", "https://chatgpt.com/c/123")).toBe("chatgpt");
    expect(classifyAiSource("", "https://huggingface.co/chat/conversation/1")).toBe("huggingchat");
  });

  it("ignores non-AI traffic and look-alike hosts", () => {
    for (const s of ["google", "bing.com", "www.bing.com/search?q=x", "(direct)", "facebook.com", "gemini.com", "fax.ai", "api.ai", "newsletter", "", "(not set)"]) {
      expect(classifyAiSource(s)).toBeNull();
    }
    expect(classifyAiSource(null, "https://huggingface.co/models")).toBeNull();
    expect(classifyAiSource(null, "https://www.bing.com/search?q=x")).toBeNull();
  });

  it("does not match tokens inside unrelated words", () => {
    expect(classifyAiSource("claudette")).toBeNull();
    expect(classifyAiSource("grokking-newsletter")).toBeNull();
  });
});

describe("patterns", () => {
  it("GA4 regex matches every platform domain", () => {
    const re = new RegExp(GA4_AI_SOURCE_REGEX, "i");
    for (const d of aiReferrerDomains()) expect(re.test(d)).toBe(true);
    expect(re.test("google")).toBe(false);
  });

  it("Piwik regex is case-insensitive re2 syntax", () => {
    expect(PIWIK_AI_SOURCE_REGEX.startsWith("(?i)(")).toBe(true);
  });

  it("every platform has a unique id and a monogram", () => {
    const ids = AI_PLATFORMS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(platformMonogram("meta_ai")).toBe("MA");
    expect(platformMonogram("phind")).toBe("PH");
  });
});
