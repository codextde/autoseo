"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { KeyRound, Loader2, Plus, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createApiKeyAction } from "../actions";
import type { ApiScope } from "../scopes";
import { ProjectScopePicker, ScopePicker, type PickerProject } from "./access-picker";
import { CodeBlock } from "./code-block";

export function CreateKeyDialog({
  workspaceId,
  projects,
  restUrl,
  mcpUrl,
  trigger,
}: {
  workspaceId: string;
  projects: PickerProject[];
  restUrl: string;
  mcpUrl: string;
  trigger?: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<ApiScope[]>(["read"]);
  const [projectIds, setProjectIds] = useState<string[] | null>(null);
  const [created, setCreated] = useState<{ token: string; name: string } | null>(null);
  const [pending, start] = useTransition();

  const reset = () => {
    setName("");
    setScopes(["read"]);
    setProjectIds(null);
    setCreated(null);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const res = await createApiKeyAction({ workspaceId, name, scopes, projectIds });
      if (!res.ok) return void toast.error(res.error);
      setCreated({ token: res.data.token, name: res.data.name });
      router.refresh();
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setTimeout(reset, 200);
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="size-4" /> Create key
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <AnimatePresence mode="wait" initial={false}>
          {created ? (
            <motion.div key="reveal" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <KeyRound className="size-4 text-brand" /> Your new API key
                </DialogTitle>
                <DialogDescription>
                  Copy “{created.name}” now — for your security it is stored hashed and will never be shown again.
                </DialogDescription>
              </DialogHeader>
              <CodeBlock code={created.token} />
              <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs">
                <ShieldAlert className="mt-px size-3.5 shrink-0 text-warning" />
                <span>Treat it like a password. Anyone with this key can read your data within its scopes. Revoke it any time.</span>
              </div>
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Try it</p>
                <CodeBlock label="REST" code={`curl ${restUrl}/me \\\n  -H "Authorization: Bearer ${created.token}"`} />
                <CodeBlock label="Claude Code" code={`claude mcp add --transport http autoseo ${mcpUrl} \\\n  --header "Authorization: Bearer ${created.token}"`} />
              </div>
              <DialogFooter>
                <Button onClick={() => setOpen(false)}>Done</Button>
              </DialogFooter>
            </motion.div>
          ) : (
            <motion.form key="form" onSubmit={submit} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-5">
              <DialogHeader>
                <DialogTitle>Create API key</DialogTitle>
                <DialogDescription>Keys authenticate the REST API and the MCP server (Cursor, VS Code, Codex, scripts).</DialogDescription>
              </DialogHeader>
              <div className="space-y-1.5">
                <Label htmlFor="key-name">Name</Label>
                <Input id="key-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Looker Studio, Cursor, n8n" maxLength={80} autoFocus required />
              </div>
              <div className="space-y-1.5">
                <Label>Scopes</Label>
                <ScopePicker value={scopes} onChange={setScopes} />
              </div>
              <div className="space-y-1.5">
                <Label>Project access</Label>
                <ProjectScopePicker projects={projects} value={projectIds} onChange={setProjectIds} />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                  Cancel
                </Button>
                <Button type="submit" disabled={pending || !name.trim() || (projectIds !== null && projectIds.length === 0)}>
                  {pending && <Loader2 className="size-4 animate-spin" />} Create key
                </Button>
              </DialogFooter>
            </motion.form>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}
