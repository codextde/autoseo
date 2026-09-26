import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

/** Strips the YAML frontmatter of a SKILL.md for rendering. */
export function stripFrontmatter(body: string): string {
  return body.replace(/^---\n[\s\S]*?\n---\n?/, "");
}

/** Renders a SKILL.md (trusted repo content; raw HTML is still skipped). */
export function SkillMarkdown({ body, className }: { body: string; className?: string }) {
  return (
    <div
      className={cn(
        "min-w-0 text-sm leading-relaxed text-foreground/90",
        "[&_a]:font-medium [&_a]:text-brand [&_a]:underline-offset-2 hover:[&_a]:underline",
        "[&_h1]:mb-3 [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:tracking-tight [&_h2]:mt-6 [&_h2]:mb-2 [&_h2]:border-b [&_h2]:pb-1.5 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mt-4 [&_h3]:mb-1.5 [&_h3]:text-sm [&_h3]:font-semibold",
        "[&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 [&_strong]:font-semibold [&_strong]:text-foreground",
        "[&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-muted [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:py-px [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-[0.84em]",
        "[&_pre]:my-3 [&_pre]:max-h-96 [&_pre]:overflow-auto [&_pre]:rounded-xl [&_pre]:border [&_pre]:bg-muted/40 [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-[11.5px] [&_pre]:leading-relaxed",
        "[&_table]:my-3 [&_table]:block [&_table]:overflow-x-auto [&_table]:text-xs [&_td]:border [&_td]:px-2 [&_td]:py-1.5 [&_th]:border [&_th]:bg-muted [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left",
        "[&>*:first-child]:mt-0",
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
        {stripFrontmatter(body)}
      </ReactMarkdown>
    </div>
  );
}
