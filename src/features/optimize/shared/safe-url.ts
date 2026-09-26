/** Returns the URL only when it is an absolute http(s) URL (for provider-returned links), else null. Isomorphic. */
export function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value || typeof value !== "string") return null;
  try {
    const u = new URL(value.trim());
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Opens a provider-returned link in a new tab — only http(s) URLs are ever opened. */
export function openExternal(value: string | null | undefined): void {
  const url = safeHttpUrl(value);
  if (url) window.open(url, "_blank", "noopener,noreferrer");
}
