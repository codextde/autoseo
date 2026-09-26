import { cn } from "@/lib/utils";
import { CopyButton } from "./copy-button";

/** Dark terminal-style code block with a copy button. `prompt` prefixes each line with `$` (not copied). */
export function CodeBlock({
  code,
  title,
  prompt = false,
  copy = true,
  wrap = false,
  className,
}: {
  code: string;
  title?: string;
  prompt?: boolean;
  copy?: boolean;
  /** Soft-wrap long lines instead of scrolling horizontally. */
  wrap?: boolean;
  className?: string;
}) {
  const lines = code.split("\n");
  return (
    <div
      className={cn(
        "not-prose overflow-hidden rounded-xl border border-white/10 bg-[#161615] text-[#ecebe6] shadow-sm dark:bg-[#0e0e0d]",
        className,
      )}
    >
      {(title || copy) && (
        <div className="flex h-10 items-center justify-between gap-3 border-b border-white/10 pr-1.5 pl-4">
          <span className="truncate font-mono text-xs text-[#b5b3ab]">{title ?? ""}</span>
          {copy && <CopyButton value={code} label={title ? `Copy ${title}` : "Copy code"} />}
        </div>
      )}
      <pre
        tabIndex={wrap ? undefined : 0}
        className={cn(wrap ? "whitespace-pre-wrap [overflow-wrap:anywhere]" : "overflow-x-auto", "p-4 font-mono text-[0.8rem] leading-6 focus-visible:ring-2 focus-visible:ring-green-400/60 focus-visible:outline-none focus-visible:ring-inset sm:text-sm")}
      >
        <code>
          {lines.map((line, i) => (
            <span key={i} className="block min-h-6">
              {prompt && line && !line.startsWith("#") && !line.startsWith(" ") && (
                <span className="text-green-400 select-none" aria-hidden="true">
                  ${" "}
                </span>
              )}
              <span className={line.startsWith("#") ? "text-[#a3a198]" : undefined}>{line}</span>
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

/** Inline one-liner with copy button (hero, pricing). */
export function CommandPill({ command, className }: { command: string; className?: string }) {
  return (
    <div
      className={cn(
        "flex max-w-full items-center gap-2 rounded-full border border-white/10 bg-[#161615] py-1 pr-1 pl-4 text-[#ecebe6] shadow-sm dark:bg-[#0e0e0d]",
        className,
      )}
    >
      <code
        tabIndex={0}
        className="scrollbar-none min-w-0 overflow-x-auto rounded-sm font-mono text-[0.78rem] whitespace-nowrap focus-visible:ring-2 focus-visible:ring-green-400/60 focus-visible:outline-none sm:text-sm"
      >
        <span className="text-green-400 select-none" aria-hidden="true">
          ${" "}
        </span>
        {command}
      </code>
      <CopyButton value={command} label="Copy install command" className="rounded-full" />
    </div>
  );
}
