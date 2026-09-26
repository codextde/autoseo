"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { motion } from "motion/react";
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Braces,
  Check,
  CircleHelp,
  Code,
  ExternalLink,
  Globe,
  ListTree,
  Loader2,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Tags,
  Trash2,
  Type,
  WandSparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PageContainer, Panel } from "@/components/app/page";
import { CopyButton, TimeAgo } from "@/components/app/misc";
import { Sparkline } from "@/components/app/charts";
import { PublishPanel } from "@/features/optimize/integrations/components";
import type { ConnectedIntegration } from "@/server/optimize/integrations/types";
import type { ContentCitation, ContentEntity, ContentFaq, contentPieces } from "@/server/db/schema/optimize";
import { scoreContent } from "@/server/optimize/content/aeo-score";
import { buildJsonLdString } from "@/server/optimize/content/schema-ld";
import { CONTENT_STATUS_META } from "@/features/optimize/constants";
import { assistContentAction, contentStateAction, retryContentAction, saveContentAction } from "../actions";
import { safeHttpUrl } from "@/features/optimize/shared/safe-url";
import { ContentStatusBadge } from "./content-ui";
import { MarkdownEditor, type EditorMode } from "./markdown-editor";
import { ScorePanel } from "./score-panel";
import type { Persona } from "./generate-dialog";

type Row = typeof contentPieces.$inferSelect;
export type SerializedContent = Omit<Row, "createdAt" | "updatedAt" | "publishedAt"> & { createdAt: string; updatedAt: string; publishedAt: string | null };

type Doc = {
  title: string;
  body: string;
  status: Row["status"];
  targetPrompt: string;
  targetKeyword: string;
  metaTitle: string;
  metaDescription: string;
  slug: string;
  schemaJsonLd: string;
  faqs: ContentFaq[];
  entities: ContentEntity[];
  citations: ContentCitation[];
};

function toDoc(c: SerializedContent): Doc {
  return {
    title: c.title,
    body: c.body,
    status: c.status,
    targetPrompt: c.targetPrompt ?? "",
    targetKeyword: c.targetKeyword ?? "",
    metaTitle: c.metaTitle ?? "",
    metaDescription: c.metaDescription ?? "",
    slug: c.slug ?? "",
    schemaJsonLd: c.schemaJsonLd ?? "",
    faqs: c.faqs ?? [],
    entities: c.entities ?? [],
    citations: c.citations ?? [],
  };
}

const GEN_STAGES = {
  article: [
    ["queued", "Queued"],
    ["research", "Researching sources"],
    ["drafting", "Writing the draft"],
    ["enriching", "FAQs, entities & schema"],
  ],
  rewrite: [
    ["queued", "Queued"],
    ["fetching", "Fetching the page"],
    ["scoring", "Scoring the original"],
    ["rewriting", "Drafting the rewrite"],
  ],
} as const;

type Props = {
  projectId: string;
  project: { name: string; domain: string; logoUrl: string | null; language: string };
  content: SerializedContent;
  persona: Persona | null;
  task: { id: string; title: string } | null;
  connected: ConnectedIntegration[];
  canEdit: boolean;
  canManage: boolean;
  aiAvailable: boolean;
  history: { date: string; score: number }[];
};

export function ContentEditor(props: Props) {
  const { content } = props;
  if (content.status === "generating") return <GeneratingView {...props} />;
  return <EditorInner {...props} />;
}

function GeneratingView({ projectId, content }: Props) {
  const router = useRouter();
  const [stage, setStage] = useState(content.generationStage ?? "queued");
  useEffect(() => {
    const t = setInterval(async () => {
      const res = await contentStateAction(projectId, content.id);
      if (!res.ok || !res.data) return;
      setStage(res.data.stage ?? "queued");
      if (res.data.status !== "generating") {
        clearInterval(t);
        router.refresh();
      }
    }, 2500);
    return () => clearInterval(t);
  }, [projectId, content.id, router]);
  const stages = GEN_STAGES[content.kind];
  const idx = Math.max(0, stages.findIndex(([k]) => k === stage));
  return (
    <PageContainer className="max-w-3xl">
      <Link href={`/p/${projectId}/content`} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> All content
      </Link>
      <Panel>
        <div className="flex flex-col items-center py-8 text-center">
          <motion.div
            className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-brand-soft text-brand"
            animate={{ scale: [1, 1.06, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            <Sparkles className="size-6" />
          </motion.div>
          <h1 className="text-lg font-semibold">{content.kind === "rewrite" ? "Analyzing the page" : "Drafting your content"}</h1>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">{content.targetPrompt ?? content.sourceUrl ?? content.title}</p>
          <ol className="mt-6 w-full max-w-sm space-y-2 text-left">
            {stages.map(([k, label], i) => (
              <li key={k} className="flex items-center gap-3 text-sm">
                <span
                  className={`flex size-6 items-center justify-center rounded-full border ${i < idx ? "border-success bg-success/12 text-success" : i === idx ? "border-brand text-brand" : "text-muted-foreground"}`}
                >
                  {i < idx ? <Check className="size-3.5" /> : i === idx ? <Loader2 className="size-3.5 animate-spin" /> : <span className="text-[10px] tabular">{i + 1}</span>}
                </span>
                <span className={i <= idx ? "text-foreground" : "text-muted-foreground"}>{label}</span>
              </li>
            ))}
          </ol>
          <p className="mt-6 text-xs text-muted-foreground">You can leave this page — the job keeps running in the background.</p>
        </div>
      </Panel>
    </PageContainer>
  );
}

function EditorInner({ projectId, project, content, persona, task, connected, canEdit, canManage, aiAvailable, history }: Props) {
  const router = useRouter();
  const [doc, setDoc] = useState<Doc>(() => toDoc(content));
  const saved = useRef<Doc>(toDoc(content));
  const [saveState, setSaveState] = useState<"saved" | "dirty" | "saving" | "error">("saved");
  const [savedAt, setSavedAt] = useState<string>(content.updatedAt);
  const [mode, setMode] = useState<EditorMode>("write");
  const [tab, setTab] = useState("suggestions");
  const [assisting, setAssisting] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [showOriginal, setShowOriginal] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const deferred = useDeferredValue(doc);
  const result = useMemo(
    () =>
      scoreContent({
        title: deferred.title,
        body: deferred.body,
        metaTitle: deferred.metaTitle,
        metaDescription: deferred.metaDescription,
        slug: deferred.slug,
        schemaJsonLd: deferred.schemaJsonLd,
        faqs: deferred.faqs,
        targetKeyword: deferred.targetKeyword,
        targetPrompt: deferred.targetPrompt,
        entities: deferred.entities,
        citations: deferred.citations,
      }),
    [deferred],
  );

  const patch = useCallback((p: Partial<Doc>) => {
    setDoc((d) => ({ ...d, ...p }));
    setSaveState("dirty");
  }, []);

  /* Debounced autosave of changed fields */
  const docRef = useRef(doc);
  const save = useCallback(async () => {
    const current = docRef.current;
    const prev = saved.current;
    const diff: Record<string, unknown> = {};
    for (const k of Object.keys(current) as (keyof Doc)[]) {
      if (JSON.stringify(current[k]) !== JSON.stringify(prev[k])) {
        const v = current[k];
        diff[k] = typeof v === "string" && k !== "body" && k !== "title" && k !== "status" ? v.trim() || null : v;
      }
    }
    if (!Object.keys(diff).length) return setSaveState("saved");
    setSaveState("saving");
    const res = await saveContentAction(projectId, content.id, diff);
    if (!res.ok) {
      setSaveState("error");
      toast.error(res.error);
      return;
    }
    saved.current = current;
    setSavedAt(res.data.updatedAt);
    setSaveState(JSON.stringify(docRef.current) === JSON.stringify(current) ? "saved" : "dirty");
  }, [projectId, content.id]);
  useEffect(() => {
    docRef.current = doc;
  }, [doc]);
  useEffect(() => {
    if (saveState !== "dirty" || !canEdit) return;
    const t = setTimeout(() => void save(), 1400);
    return () => clearTimeout(t);
  }, [doc, saveState, save, canEdit]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (saveState === "dirty" || saveState === "saving") e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saveState]);

  const assist = (kind: "faqs" | "entities" | "meta") => {
    setAssisting(kind);
    start(async () => {
      const res = await assistContentAction(projectId, kind, {
        title: doc.title,
        body: doc.body,
        targetPrompt: doc.targetPrompt || null,
        targetKeyword: doc.targetKeyword || null,
      });
      setAssisting(null);
      if (!res.ok) return void toast.error(res.error);
      const by = res.data.by === "ai" ? "AI" : "extracted from the article";
      if (res.data.kind === "faqs") {
        const faqs = res.data.data as ContentFaq[];
        if (!faqs.length) return void toast("No FAQs found", { description: "Add question-style H2s or connect an AI provider to generate FAQs." });
        patch({ faqs });
        toast.success(`${faqs.length} FAQs (${by})`);
      } else if (res.data.kind === "entities") {
        const entities = res.data.data as ContentEntity[];
        patch({ entities });
        toast.success(`${entities.length} entities (${by})`);
      } else {
        const m = res.data.data as { metaTitle: string; metaDescription: string };
        patch({ metaTitle: m.metaTitle, metaDescription: m.metaDescription });
        toast.success(`Meta tags written (${by})`);
      }
    });
  };

  const generateSchema = () => {
    const json = buildJsonLdString({
      title: doc.title,
      description: doc.metaDescription || null,
      url: content.publishedUrl ?? null,
      language: content.language,
      publisherName: project.name,
      publisherUrl: `https://${project.domain}`,
      publisherLogo: project.logoUrl,
      datePublished: content.publishedAt?.slice(0, 10) ?? content.createdAt.slice(0, 10),
      dateModified: new Date().toISOString().slice(0, 10),
      faqs: doc.faqs,
      entities: doc.entities,
      type: /(^|\n)1\.\s/.test(doc.body) && /how to|wie/i.test(doc.title) ? "HowTo" : "Article",
      howToSteps: [...doc.body.matchAll(/^\d+\.\s+(.+)$/gm)].map((m) => m[1]!).slice(0, 12),
    });
    patch({ schemaJsonLd: json });
    toast.success("JSON-LD generated from the article");
  };

  const schemaCheck = useMemo(() => {
    if (!doc.schemaJsonLd.trim()) return null;
    try {
      const parsed = JSON.parse(doc.schemaJsonLd);
      const types = new Set<string>();
      const visit = (n: unknown) => {
        if (Array.isArray(n)) return n.forEach(visit);
        if (n && typeof n === "object") {
          const t = (n as Record<string, unknown>)["@type"];
          (Array.isArray(t) ? t : t ? [t] : []).forEach((x) => types.add(String(x)));
          Object.values(n as Record<string, unknown>).forEach((v) => typeof v === "object" && visit(v));
        }
      };
      visit(parsed);
      return { ok: true as const, types: [...types] };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "Invalid JSON" };
    }
  }, [doc.schemaJsonLd]);

  const jumpToHeading = (line: number) => {
    const el = textareaRef.current;
    if (!el) return;
    setMode((m) => (m === "preview" ? "write" : m));
    const idx = doc.body.split("\n").slice(0, line).join("\n").length + (line ? 1 : 0);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(idx, idx);
      const lineHeight = 22;
      el.scrollTop = Math.max(0, line * lineHeight - 80);
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  };

  const snapshot = content.sourceSnapshot as
    | { originalScore?: number; originalMarkdown?: string; changes?: string[]; finalUrl?: string; jsonLdTypes?: string[]; wordCount?: number }
    | null;
  const baseline = content.baselineScore;

  const goTo = (t: string) => {
    if (t === "write") {
      setMode("write");
      textareaRef.current?.focus();
    } else setTab(t);
  };

  const metaTitleLen = doc.metaTitle.trim().length;
  const metaDescLen = doc.metaDescription.trim().length;

  return (
    <PageContainer wide className="max-w-[1600px]">
      {/* Header */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link href={`/p/${projectId}/content`} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" /> All content
          </Link>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {saveState === "saving" ? (
              <span className="inline-flex items-center gap-1">
                <Loader2 className="size-3 animate-spin" /> Saving…
              </span>
            ) : saveState === "dirty" ? (
              <span>Unsaved changes</span>
            ) : saveState === "error" ? (
              <button type="button" className="text-destructive underline" onClick={() => void save()}>
                Save failed — retry
              </button>
            ) : (
              <span className="inline-flex items-center gap-1">
                <Check className="size-3 text-success" /> Saved <TimeAgo date={savedAt} />
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <Input
            value={doc.title}
            onChange={(e) => patch({ title: e.target.value })}
            readOnly={!canEdit}
            className="h-auto border-none bg-transparent px-0 text-xl font-semibold tracking-tight shadow-none focus-visible:ring-0 sm:text-2xl dark:bg-transparent"
            aria-label="Title"
          />
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {canEdit ? (
              <Select value={doc.status} onValueChange={(v) => patch({ status: v as Doc["status"] })}>
                <SelectTrigger size="sm" className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["draft", "in_review", "published"] as const).map((s) => (
                    <SelectItem key={s} value={s}>
                      {CONTENT_STATUS_META[s].label}
                    </SelectItem>
                  ))}
                  {doc.status === "failed" && <SelectItem value="failed">Failed</SelectItem>}
                </SelectContent>
              </Select>
            ) : (
              <ContentStatusBadge status={doc.status} />
            )}
            <Button size="sm" variant="outline" onClick={() => setTab("publish")}>
              <Send className="size-3.5" /> Publish
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {content.kind === "rewrite" && safeHttpUrl(content.sourceUrl) && (
            <a href={safeHttpUrl(content.sourceUrl)!} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-foreground">
              <Globe className="size-3" /> {content.sourceUrl!.replace(/^https?:\/\/(www\.)?/, "")}
            </a>
          )}
          {persona && (
            <span className="inline-flex items-center gap-1">
              <Bot className="size-3" /> Written as {persona.name}
            </span>
          )}
          {task && (
            <Link href={`/p/${projectId}/tasks/${task.id}`} className="inline-flex items-center gap-1 hover:text-foreground">
              From task: <span className="max-w-64 truncate font-medium">{task.title}</span>
            </Link>
          )}
          {safeHttpUrl(content.publishedUrl) && (
            <a href={safeHttpUrl(content.publishedUrl)!} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline">
              <ExternalLink className="size-3" /> Live page
            </a>
          )}
        </div>
      </div>

      {doc.status === "failed" && content.error && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>{content.kind === "rewrite" ? "Page analysis failed" : "Generation failed"}</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-2">
            {content.error}
            {canEdit && (
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const res = await retryContentAction(projectId, content.id);
                    if (!res.ok) return void toast.error(res.error);
                    router.refresh();
                  })
                }
              >
                <RefreshCw className="size-3.5" /> Retry
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* Main column */}
        <div className="min-w-0 space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Target question / prompt</Label>
              <Input value={doc.targetPrompt} onChange={(e) => patch({ targetPrompt: e.target.value })} readOnly={!canEdit} placeholder="What should this page answer?" className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Target keyword</Label>
              <Input value={doc.targetKeyword} onChange={(e) => patch({ targetKeyword: e.target.value })} readOnly={!canEdit} placeholder="Primary keyword" className="h-8 text-sm" />
            </div>
          </div>

          {result.outline.length > 0 && (
            <details className="group rounded-xl border bg-card px-3 py-2 text-sm" open>
              <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium text-muted-foreground">
                <ListTree className="size-3.5" /> Outline · {result.outline.length} headings
              </summary>
              <ol className="mt-2 max-h-48 space-y-0.5 overflow-y-auto">
                {result.outline.map((h, i) => (
                  <li key={`${h.line}-${i}`}>
                    <button
                      type="button"
                      onClick={() => jumpToHeading(h.line)}
                      className="w-full truncate rounded px-1.5 py-0.5 text-left hover:bg-muted"
                      style={{ paddingLeft: `${(h.level - 1) * 12 + 6}px` }}
                    >
                      <span className="mr-1.5 text-[10px] text-muted-foreground">H{h.level}</span>
                      {h.text}
                    </button>
                  </li>
                ))}
              </ol>
            </details>
          )}

          {content.kind === "rewrite" && snapshot?.originalMarkdown && (
            <div className="flex items-center gap-2 text-xs">
              <div className="flex rounded-lg bg-muted p-0.5">
                <button type="button" onClick={() => setShowOriginal(false)} className={`rounded-md px-2.5 py-1 font-medium ${!showOriginal ? "bg-background shadow-xs" : "text-muted-foreground"}`}>
                  Optimized
                </button>
                <button type="button" onClick={() => setShowOriginal(true)} className={`rounded-md px-2.5 py-1 font-medium ${showOriginal ? "bg-background shadow-xs" : "text-muted-foreground"}`}>
                  Original page
                </button>
              </div>
              {snapshot.originalScore != null && <span className="text-muted-foreground tabular">Original score {snapshot.originalScore} → now {result.score}</span>}
            </div>
          )}

          {showOriginal && snapshot?.originalMarkdown ? (
            <MarkdownEditor value={snapshot.originalMarkdown} onChange={() => {}} mode="preview" onModeChange={() => {}} readOnly />
          ) : (
            <MarkdownEditor value={doc.body} onChange={(v) => patch({ body: v })} mode={mode} onModeChange={setMode} readOnly={!canEdit} textareaRef={textareaRef} />
          )}
        </div>

        {/* Side panel */}
        <aside className="min-w-0 space-y-3 lg:sticky lg:top-16 lg:max-h-[calc(100dvh-5rem)] lg:overflow-y-auto">
          <Panel contentClassName="p-4">
            <ScorePanel result={result} baseline={content.kind === "rewrite" ? baseline : null} onGoTo={goTo} compact />
            {history.length >= 2 && (
              <div className="mt-3 flex items-center justify-between gap-3 border-t pt-3 text-xs text-muted-foreground">
                Score history
                <Sparkline values={history.map((h) => h.score)} height={32} color="var(--brand)" className="w-40" />
              </div>
            )}
          </Panel>

          <Panel contentClassName="p-0">
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="flex h-auto w-full flex-wrap justify-start gap-0.5 rounded-none border-b bg-transparent p-1.5">
                {[
                  ["suggestions", "Fixes", WandSparkles],
                  ["meta", "Meta", Type],
                  ["faq", "FAQ", CircleHelp],
                  ["schema", "Schema", Braces],
                  ["entities", "Entities", Tags],
                  ["sources", "Sources", Globe],
                  ["publish", "Publish", Send],
                ].map(([k, label, Icon]) => {
                  const I = Icon as typeof Send;
                  return (
                    <TabsTrigger key={k as string} value={k as string} className="h-7 flex-none gap-1 px-2 text-xs">
                      <I className="size-3.5" />
                      {label as string}
                    </TabsTrigger>
                  );
                })}
              </TabsList>

              <TabsContent value="suggestions" className="p-4">
                <ScorePanel result={result} onGoTo={goTo} />
              </TabsContent>

              <TabsContent value="meta" className="space-y-4 p-4">
                <div className="space-y-1.5">
                  <Label className="flex justify-between text-xs">
                    Meta title
                    <span className={metaTitleLen >= 30 && metaTitleLen <= 60 ? "text-success tabular" : "text-muted-foreground tabular"}>{metaTitleLen}/60</span>
                  </Label>
                  <Input value={doc.metaTitle} onChange={(e) => patch({ metaTitle: e.target.value })} readOnly={!canEdit} />
                </div>
                <div className="space-y-1.5">
                  <Label className="flex justify-between text-xs">
                    Meta description
                    <span className={metaDescLen >= 120 && metaDescLen <= 160 ? "text-success tabular" : "text-muted-foreground tabular"}>{metaDescLen}/160</span>
                  </Label>
                  <Textarea rows={3} value={doc.metaDescription} onChange={(e) => patch({ metaDescription: e.target.value })} readOnly={!canEdit} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">URL slug</Label>
                  <Input value={doc.slug} onChange={(e) => patch({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-") })} readOnly={!canEdit} />
                </div>
                <div className="rounded-xl border bg-background p-3">
                  <div className="text-[11px] text-muted-foreground">Search / AI snippet preview</div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">
                    {project.domain} › {doc.slug || "…"}
                  </div>
                  <div className="line-clamp-1 text-[15px] font-medium text-info">{doc.metaTitle || doc.title}</div>
                  <div className="line-clamp-2 text-xs text-muted-foreground">{doc.metaDescription || "Add a meta description that answers the question in one sentence."}</div>
                </div>
                {canEdit && (
                  <Button size="sm" variant="outline" className="w-full" onClick={() => assist("meta")} disabled={pending}>
                    {assisting === "meta" ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                    {aiAvailable ? "Write meta tags with AI" : "Suggest from the article"}
                  </Button>
                )}
              </TabsContent>

              <TabsContent value="faq" className="space-y-3 p-4">
                <p className="text-xs text-muted-foreground">FAQs are appended to the page on publish and marked up as FAQPage.</p>
                {doc.faqs.map((f, i) => (
                  <div key={i} className="space-y-1.5 rounded-xl border p-2.5">
                    <div className="flex items-start gap-1.5">
                      <Input
                        value={f.question}
                        onChange={(e) => patch({ faqs: doc.faqs.map((x, j) => (j === i ? { ...x, question: e.target.value } : x)) })}
                        readOnly={!canEdit}
                        className="h-8 text-sm font-medium"
                        placeholder="Question"
                      />
                      {canEdit && (
                        <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={() => patch({ faqs: doc.faqs.filter((_, j) => j !== i) })} aria-label="Remove FAQ">
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                    </div>
                    <Textarea
                      rows={3}
                      value={f.answer}
                      onChange={(e) => patch({ faqs: doc.faqs.map((x, j) => (j === i ? { ...x, answer: e.target.value } : x)) })}
                      readOnly={!canEdit}
                      className="text-sm"
                      placeholder="Answer (40–80 words)"
                    />
                  </div>
                ))}
                {canEdit && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="flex-1" onClick={() => patch({ faqs: [...doc.faqs, { question: "", answer: "" }] })}>
                      <Plus className="size-3.5" /> Add FAQ
                    </Button>
                    <Button size="sm" variant="outline" className="flex-1" onClick={() => assist("faqs")} disabled={pending}>
                      {assisting === "faqs" ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                      {aiAvailable ? "Generate FAQs" : "Extract FAQs"}
                    </Button>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="schema" className="space-y-3 p-4">
                <div className="flex flex-wrap gap-2">
                  {canEdit && (
                    <Button size="sm" variant="outline" onClick={generateSchema}>
                      <Code className="size-3.5" /> Generate JSON-LD
                    </Button>
                  )}
                  {doc.schemaJsonLd && <CopyButton value={`<script type="application/ld+json">\n${doc.schemaJsonLd}\n</script>`} label="Copy <script>" />}
                </div>
                {schemaCheck && (
                  <div className={`rounded-lg px-2.5 py-1.5 text-xs ${schemaCheck.ok ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
                    {schemaCheck.ok ? `Valid JSON · ${schemaCheck.types.join(", ") || "no @type"}` : `Invalid JSON: ${schemaCheck.error}`}
                  </div>
                )}
                <Textarea
                  rows={16}
                  value={doc.schemaJsonLd}
                  onChange={(e) => patch({ schemaJsonLd: e.target.value })}
                  readOnly={!canEdit}
                  className="font-mono text-[11.5px]"
                  placeholder='{"@context": "https://schema.org", …}'
                />
                <p className="text-[11px] text-muted-foreground">Generated from title, meta description, FAQs and entities: Organization + Article (or HowTo) + FAQPage.</p>
              </TabsContent>

              <TabsContent value="entities" className="space-y-3 p-4">
                <p className="text-xs text-muted-foreground">Entities connect your page to known things — used for about/mentions in the schema.</p>
                <div className="flex flex-wrap gap-1.5">
                  {doc.entities.map((e, i) => (
                    <span key={`${e.name}-${i}`} className="inline-flex items-center gap-1 rounded-full border bg-background py-0.5 pr-1 pl-2 text-xs">
                      {e.name}
                      {e.type && e.type !== "Thing" && <span className="text-muted-foreground">· {e.type}</span>}
                      {safeHttpUrl(e.sameAs) && (
                        <a href={safeHttpUrl(e.sameAs)!} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground">
                          <ExternalLink className="size-3" />
                        </a>
                      )}
                      {canEdit && (
                        <button type="button" onClick={() => patch({ entities: doc.entities.filter((_, j) => j !== i) })} className="rounded-full p-0.5 text-muted-foreground hover:bg-muted" aria-label={`Remove ${e.name}`}>
                          ×
                        </button>
                      )}
                    </span>
                  ))}
                  {!doc.entities.length && <span className="text-sm text-muted-foreground">No entities yet.</span>}
                </div>
                {canEdit && (
                  <>
                    <EntityAdder onAdd={(name) => patch({ entities: [...doc.entities, { name, type: "Thing" }] })} />
                    <Button size="sm" variant="outline" className="w-full" onClick={() => assist("entities")} disabled={pending}>
                      {assisting === "entities" ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                      {aiAvailable ? "Extract entities with AI" : "Extract entities"}
                    </Button>
                  </>
                )}
              </TabsContent>

              <TabsContent value="sources" className="space-y-3 p-4">
                {content.brief && (content.brief.angle || content.brief.keyTakeaways?.length) ? (
                  <div className="space-y-1.5 rounded-xl bg-muted/50 p-3 text-xs">
                    <div className="font-semibold text-foreground">Brief</div>
                    {content.brief.audience && <p><span className="text-muted-foreground">Audience:</span> {content.brief.audience}</p>}
                    {content.brief.angle && <p><span className="text-muted-foreground">Angle:</span> {content.brief.angle}</p>}
                    {content.brief.keyTakeaways?.length ? (
                      <ul className="list-disc pl-4">
                        {content.brief.keyTakeaways.map((k) => (
                          <li key={k}>{k}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
                {snapshot?.changes?.length ? (
                  <div className="space-y-1 rounded-xl border p-3 text-xs">
                    <div className="font-semibold">What changed vs. the original</div>
                    <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
                      {snapshot.changes.map((c) => (
                        <li key={c}>{c}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <div className="text-xs font-semibold text-muted-foreground uppercase">Citations ({doc.citations.length})</div>
                {doc.citations.length ? (
                  <ol className="space-y-1.5">
                    {doc.citations.map((c, i) => (
                      <li key={c.url} className="flex items-start gap-2 text-sm">
                        <span className="w-4 shrink-0 text-xs text-muted-foreground tabular">{i + 1}</span>
                        <div className="min-w-0 flex-1">
                          <a href={safeHttpUrl(c.url) ?? undefined} target="_blank" rel="noopener noreferrer nofollow" className="line-clamp-1 font-medium text-brand hover:underline">
                            {c.title || c.url}
                          </a>
                          <div className="truncate text-[11px] text-muted-foreground">{c.url.replace(/^https?:\/\/(www\.)?/, "")}</div>
                          {c.note && <div className="text-xs text-muted-foreground">{c.note}</div>}
                        </div>
                        {canEdit && (
                          <button type="button" onClick={() => patch({ citations: doc.citations.filter((x) => x.url !== c.url) })} className="text-muted-foreground hover:text-foreground" aria-label="Remove source">
                            <Trash2 className="size-3.5" />
                          </button>
                        )}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-sm text-muted-foreground">No sources yet. Link authoritative sources inline in the article — they count toward fact density.</p>
                )}
                {canEdit && <SourceAdder onAdd={(c) => patch({ citations: [...doc.citations.filter((x) => x.url !== c.url), c] })} />}
              </TabsContent>

              <TabsContent value="publish" className="p-4">
                {saveState !== "saved" && <p className="mb-3 rounded-lg bg-warning/15 px-2.5 py-1.5 text-xs text-warning">Saving your latest changes before publishing…</p>}
                <PublishPanel
                  projectId={projectId}
                  contentId={content.id}
                  connected={connected}
                  canEdit={canEdit && saveState === "saved"}
                  canManage={canManage}
                  published={{ url: content.publishedUrl, provider: content.publishProvider, externalId: content.externalId, publishedAt: content.publishedAt }}
                />
              </TabsContent>
            </Tabs>
          </Panel>
        </aside>
      </div>
    </PageContainer>
  );
}

function EntityAdder({ onAdd }: { onAdd: (name: string) => void }) {
  const [v, setV] = useState("");
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (v.trim()) onAdd(v.trim());
        setV("");
      }}
    >
      <Input value={v} onChange={(e) => setV(e.target.value)} placeholder="Add entity" className="h-8 text-sm" />
      <Button type="submit" size="sm" variant="outline" disabled={!v.trim()}>
        Add
      </Button>
    </form>
  );
}

function SourceAdder({ onAdd }: { onAdd: (c: ContentCitation) => void }) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const valid = /^https?:\/\/\S+\.\S+/.test(url.trim());
  return (
    <form
      className="space-y-2 border-t pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        onAdd({ url: url.trim(), title: title.trim() || null });
        setUrl("");
        setTitle("");
      }}
    >
      <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://source…" className="h-8 text-sm" />
      <div className="flex gap-2">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" className="h-8 text-sm" />
        <Button type="submit" size="sm" variant="outline" disabled={!valid}>
          Add source
        </Button>
      </div>
    </form>
  );
}
