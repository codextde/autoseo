import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

function display(value: string) {
  try {
    return decodeURI(value).replace(/#:~:.*$/, "");
  } catch {
    return value;
  }
}

/** Safe external link (http/https only) that opens in a new tab. */
export function ExternalUrl({ href, label, className, maxWidth = "max-w-[26rem]" }: { href: string | null | undefined; label?: string | null; className?: string; maxWidth?: string }) {
  if (!href || !/^https?:\/\//i.test(href)) return <span className="text-muted-foreground">{label ?? "—"}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className={cn("group/link inline-flex min-w-0 items-center gap-1 text-foreground hover:underline", maxWidth, className)}
      title={display(href)}
    >
      <span className="truncate">{display(label ?? href)}</span>
      <ExternalLink className="size-3 shrink-0 opacity-40 group-hover/link:opacity-80" />
    </a>
  );
}

export function middleTruncate(value: string, max = 48) {
  if (value.length <= max) return value;
  const half = Math.floor((max - 1) / 2);
  return `${value.slice(0, half)}…${value.slice(-half)}`;
}
