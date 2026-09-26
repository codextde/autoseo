/** Only same-origin relative paths ("/dashboard?x=1"). Rejects protocol-relative, backslash and control-char tricks. */
export function safeNext(next: string | null | undefined): string | null {
  if (!next || typeof next !== "string") return null;
  if (!next.startsWith("/") || next.startsWith("//") || /[\\\s\x00-\x1f]/.test(next)) return null;
  try {
    const url = new URL(next, "http://internal.invalid");
    if (url.origin !== "http://internal.invalid") return null;
    return url.pathname + url.search + url.hash;
  } catch {
    return null;
  }
}
