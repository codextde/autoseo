"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Sparkles, UserRoundPen, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useUrlState } from "@/hooks/use-url-state";
import type { contentPersonas } from "@/server/db/schema/optimize";
import { createBlankContentAction, generateContentAction, generatePersonasAction, listPersonasAction } from "../actions";

export type Persona = typeof contentPersonas.$inferSelect;

const TYPES = [
  { value: "article", label: "Answer article" },
  { value: "guide", label: "Ultimate guide" },
  { value: "comparison", label: "Comparison / vs page" },
  { value: "listicle", label: "Best-of list" },
  { value: "how-to", label: "How-to" },
  { value: "faq", label: "FAQ page" },
  { value: "product", label: "Product / landing page" },
];

export function GenerateDialog({
  projectId,
  personas: initialPersonas,
  aiAvailable,
  language,
  open,
  onOpenChange,
}: {
  projectId: string;
  personas: Persona[];
  aiAvailable: boolean;
  language: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const router = useRouter();
  const [prefill, setPrefill] = useUrlState("generate", "");
  const [pending, start] = useTransition();
  const [personas, setPersonas] = useState(initialPersonas);
  const [syncedFrom, setSyncedFrom] = useState(initialPersonas);
  if (syncedFrom !== initialPersonas) {
    setSyncedFrom(initialPersonas);
    setPersonas(initialPersonas);
  }
  const [target, setTarget] = useState(() => (prefill && prefill !== "1" ? prefill : ""));
  const [keyword, setKeyword] = useState("");
  const [type, setType] = useState("article");
  const [words, setWords] = useState(1500);
  const [personaId, setPersonaId] = useState("brand");
  const [includeFaq, setIncludeFaq] = useState(true);
  const [instructions, setInstructions] = useState("");
  const [lang, setLang] = useState(language);
  const [personaBusy, setPersonaBusy] = useState(false);


  const byTopic = useMemo(() => {
    const m = new Map<string, Persona[]>();
    for (const p of personas) {
      if (!m.has(p.topic)) m.set(p.topic, []);
      m.get(p.topic)!.push(p);
    }
    return [...m.entries()];
  }, [personas]);
  const selectedPersona = personas.find((p) => p.id === personaId);

  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o && prefill) setPrefill(null);
  };

  const makePersonas = () => {
    const topic = (keyword || target).trim();
    if (topic.length < 2) return void toast.error("Enter a topic or keyword first");
    setPersonaBusy(true);
    start(async () => {
      const res = await generatePersonasAction(projectId, topic);
      if (!res.ok) {
        setPersonaBusy(false);
        return void toast.error(res.error);
      }
      if (res.data.mode === "library") {
        const list = await listPersonasAction(projectId);
        if (list.ok) setPersonas(list.data);
        setPersonaBusy(false);
        toast.success(`${res.data.created} expert personas added for “${topic}”`);
        return;
      }
      toast("Generating expert personas…", { description: "This takes about a minute." });
      const before = personas.length;
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const list = await listPersonasAction(projectId);
        if (list.ok && list.data.length > before) {
          setPersonas(list.data);
          toast.success(`${list.data.length - before} personas ready`);
          break;
        }
      }
      setPersonaBusy(false);
    });
  };

  const submit = () =>
    start(async () => {
      const res = await generateContentAction(projectId, {
        target,
        keyword,
        contentType: type as "article",
        wordCount: words,
        personaId: personaId === "brand" ? null : personaId,
        includeFaq,
        instructions,
        language: lang,
      });
      if (!res.ok) return void toast.error(res.error);
      toast.success("Drafting started", { description: "Research → brief → draft → FAQ & schema. You can keep working meanwhile." });
      close(false);
      router.push(`/p/${projectId}/content/${res.data.id}`);
    });

  const blank = () =>
    start(async () => {
      const res = await createBlankContentAction(projectId, { title: target || "Untitled draft", targetPrompt: target, keyword });
      if (!res.ok) return void toast.error(res.error);
      close(false);
      router.push(`/p/${projectId}/content/${res.data.id}`);
    });

  return (
    <Dialog open={open || !!prefill} onOpenChange={close}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-brand" /> Generate content
          </DialogTitle>
          <DialogDescription>
            Expert-backed drafts grounded in real sources: web research → brief → draft in an expert&apos;s voice → FAQs, entities & schema → AEO score.
          </DialogDescription>
        </DialogHeader>

        {!aiAvailable && (
          <Alert>
            <AlertTitle>No AI provider connected</AlertTitle>
            <AlertDescription>
              Drafting needs a local agent or an API key. Connect one in{" "}
              <Link href="/agents" className="font-medium underline">
                Local Agents
              </Link>{" "}
              or{" "}
              <Link href="/admin/ai" className="font-medium underline">
                Admin → AI Providers
              </Link>
              . You can still start a blank draft and get live AEO scoring.
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="g-target">Topic or question to answer</Label>
            <Textarea
              id="g-target"
              rows={2}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="e.g. How much does a balcony power plant cost in 2026?"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="g-kw">Target keyword</Label>
              <Input id="g-kw" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="optional" />
            </div>
            <div className="space-y-1.5">
              <Label>Format</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="g-lang">Language</Label>
              <Input id="g-lang" value={lang} onChange={(e) => setLang(e.target.value.slice(0, 8))} />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="flex justify-between">
              Length <span className="text-muted-foreground tabular">~{words.toLocaleString()} words</span>
            </Label>
            <Slider min={500} max={3500} step={100} value={[words]} onValueChange={(v) => setWords(v[0] ?? words)} />
          </div>

          <div className="space-y-2 rounded-xl border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label className="flex items-center gap-1.5">
                <UserRoundPen className="size-3.5" /> Expert persona
              </Label>
              <Button type="button" variant="ghost" size="sm" onClick={makePersonas} disabled={personaBusy || pending}>
                {personaBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Users className="size-3.5" />}
                {aiAvailable ? "Generate personas for this topic" : "Add persona library for this topic"}
              </Button>
            </div>
            <Select value={personaId} onValueChange={setPersonaId}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-80">
                <SelectItem value="brand">Brand voice (no persona)</SelectItem>
                {byTopic.map(([topic, list]) => (
                  <SelectGroup key={topic}>
                    <SelectLabel>{topic}</SelectLabel>
                    {list.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} — {p.role}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
            {selectedPersona && (
              <p className="text-xs text-muted-foreground">
                {selectedPersona.bio} <span className="italic">Voice: {selectedPersona.voice}</span>
              </p>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 rounded-xl bg-muted/50 px-3 py-2.5">
            <div>
              <div className="text-sm font-medium">FAQ block & FAQPage schema</div>
              <div className="text-xs text-muted-foreground">5–7 follow-up questions answered from the article.</div>
            </div>
            <Switch checked={includeFaq} onCheckedChange={setIncludeFaq} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="g-ins">Extra instructions</Label>
            <Textarea id="g-ins" rows={2} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Angle, facts to include, products to mention…" />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" onClick={blank} disabled={pending}>
            Start blank draft
          </Button>
          <Button onClick={submit} disabled={pending || !aiAvailable || target.trim().length < 3}>
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />} Generate draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
