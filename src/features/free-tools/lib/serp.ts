/** SERP simulator helpers (pure). Google renders desktop titles in 20px Arial; snippets are ~600px (desktop) / ~328px (mobile) wide. */
export const DESKTOP_TITLE_WIDTH = 600;
export const MOBILE_TEXT_WIDTH = 328;
export const TITLE_FONT = "20px Arial, sans-serif";

function safeDecode(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** "https://www.example.com/blog/post/?q=1" → { origin: "https://www.example.com", host: "www.example.com", crumbs: ["blog", "post"] } */
export function breadcrumbParts(url: string): { host: string; crumbs: string[]; origin: string } {
  const trimmed = url.trim();
  const display = trimmed.replace(/^https?:\/\//i, "").replace(/[?#].*$/, "").replace(/\/+$/, "");
  const [host = "", ...segments] = display.split("/");
  const scheme = /^http:\/\//i.test(trimmed) ? "http://" : "https://";
  return { host, crumbs: segments.filter(Boolean).map(safeDecode), origin: host ? `${scheme}${host}` : "" };
}
