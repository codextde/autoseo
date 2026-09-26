"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, CheckCircle2, Loader2, MailPlus, ShieldCheck, Terminal, XCircle } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MultiSelect } from "@/components/app/filters";
import { CopyButton } from "@/components/app/misc";
import { cn } from "@/lib/utils";
import { ChipsInput } from "./settings-kit";
import { createInvitationsAction, type InviteResult } from "../actions/invitations";

export type InviteContext = {
  workspaces: { id: string; name: string }[];
  roles: { key: string; name: string; description: string | null; allProjects: boolean; grantsAdmin: boolean }[];
  projects: { id: string; name: string; domain: string; workspaceId: string }[];
  allowedDomains: string[];
  defaultRoleKey: string;
  inviteDays: number;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function domainAllowed(email: string, allowed: string[]) {
  if (!allowed.length) return true;
  const domain = email.split("@")[1] ?? "";
  return allowed.some((d) => domain === d || domain.endsWith(`.${d}`));
}

export function InviteDialog({
  open,
  onOpenChange,
  context,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  context: InviteContext;
}) {
  const router = useRouter();
  const [emails, setEmails] = useState<string[]>([]);
  const [workspaceId, setWorkspaceId] = useState(context.workspaces[0]?.id ?? "");
  const [roleKey, setRoleKey] = useState(
    context.roles.some((r) => r.key === context.defaultRoleKey) ? context.defaultRoleKey : (context.roles[0]?.key ?? "member"),
  );
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [makeAdmin, setMakeAdmin] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<InviteResult[] | null>(null);

  const role = context.roles.find((r) => r.key === roleKey);
  const wsProjects = useMemo(() => context.projects.filter((p) => p.workspaceId === workspaceId), [context.projects, workspaceId]);
  const blocked = emails.filter((e) => !domainAllowed(e, context.allowedDomains));
  const valid = emails.filter((e) => domainAllowed(e, context.allowedDomains));

  const reset = () => {
    setEmails([]);
    setProjectIds([]);
    setMakeAdmin(false);
    setMessage("");
    setResults(null);
  };

  const submit = async () => {
    if (!valid.length) return;
    setBusy(true);
    try {
      const res = await createInvitationsAction({
        emails: valid,
        workspaceId,
        roleKey,
        projectIds: role?.allProjects ? [] : projectIds,
        makeInstanceAdmin: makeAdmin,
        message: message || null,
      });
      if (!res.ok) return void toast.error(res.error);
      setResults(res.data);
      const okCount = res.data.filter((r) => r.ok).length;
      if (okCount) toast.success(`${okCount} invitation${okCount > 1 ? "s" : ""} created`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) setTimeout(reset, 200);
      }}
    >
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MailPlus className="size-4" /> Invite people
          </DialogTitle>
          <DialogDescription>
            They get a sign-in link by email (valid {context.inviteDays} days) and join the workspace with the chosen role.
          </DialogDescription>
        </DialogHeader>

        <AnimatePresence mode="wait" initial={false}>
          {results ? (
            <motion.div key="results" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
              <ul className="divide-y rounded-xl border">
                {results.map((r) => (
                  <li key={r.email} className="flex items-start gap-2.5 p-3">
                    {r.ok ? (
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                    ) : (
                      <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{r.email}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.ok
                          ? r.existingAccount
                            ? "Existing account — access is granted at their next sign-in"
                            : r.delivered
                              ? "Invitation email sent"
                              : r.transport === "log"
                                ? "Email delivery not configured — share the link manually"
                                : "Email could not be sent — share the link manually"
                          : r.error}
                      </div>
                    </div>
                    {r.ok && r.url && <CopyButton value={r.url} label="Copy link" className="h-7 shrink-0" />}
                  </li>
                ))}
              </ul>
              {results.some((r) => r.ok && r.transport === "log") && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Terminal className="size-3.5" /> Configure SMTP in Admin → Email so invitations are delivered automatically.
                </p>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={reset}>
                  Invite more
                </Button>
                <Button onClick={() => onOpenChange(false)}>Done</Button>
              </DialogFooter>
            </motion.div>
          ) : (
            <motion.div key="form" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="invite-emails">Email addresses</Label>
                <ChipsInput
                  id="invite-emails"
                  value={emails}
                  onChange={setEmails}
                  placeholder="name@company.com, …"
                  normalize={(s) => s.trim().toLowerCase().replace(/^<|>$/g, "")}
                  validate={(s) => (EMAIL_RE.test(s) ? null : `"${s}" is not a valid email address.`)}
                  renderChip={(e) => (
                    <span className={cn("inline-flex items-center gap-1", !domainAllowed(e, context.allowedDomains) && "text-destructive line-through")}>
                      <span
                        className={cn(
                          "size-1.5 rounded-full",
                          domainAllowed(e, context.allowedDomains) ? "bg-success" : "bg-destructive",
                        )}
                      />
                      {e}
                    </span>
                  )}
                />
                {context.allowedDomains.length > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Allowed domains: {context.allowedDomains.map((d) => `@${d}`).join(", ")}. Paste several addresses at once.
                  </p>
                ) : (
                  <p className="flex items-center gap-1 text-xs text-warning">
                    <AlertTriangle className="size-3" /> No domain allow-list — any email address can be invited.
                  </p>
                )}
                {blocked.length > 0 && (
                  <p className="text-xs text-destructive">
                    {blocked.length} address{blocked.length > 1 ? "es are" : " is"} outside the allowed domains and will be skipped.
                  </p>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Workspace</Label>
                  <Select
                    value={workspaceId}
                    onValueChange={(v) => {
                      setWorkspaceId(v);
                      setProjectIds([]);
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select workspace" />
                    </SelectTrigger>
                    <SelectContent>
                      {context.workspaces.map((w) => (
                        <SelectItem key={w.id} value={w.id}>
                          {w.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Role</Label>
                  <Select value={roleKey} onValueChange={setRoleKey}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {context.roles.map((r) => (
                        <SelectItem key={r.key} value={r.key}>
                          {r.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {role?.description && <p className="-mt-2 text-xs text-muted-foreground">{role.description}</p>}
              {role?.grantsAdmin && (
                <p className="-mt-1 flex items-start gap-1.5 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
                  <AlertTriangle className="mt-px size-3.5 shrink-0" />
                  The {role.name} role includes “Access the admin panel” — invitees become instance admins. Adjust this in Roles &amp;
                  Permissions if that&apos;s not intended.
                </p>
              )}

              <div className="space-y-1.5">
                <Label>Project access</Label>
                {role?.allProjects ? (
                  <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                    {role.name} can access all projects in the workspace (current & future).
                  </p>
                ) : wsProjects.length === 0 ? (
                  <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">This workspace has no projects yet.</p>
                ) : (
                  <MultiSelect
                    options={wsProjects.map((p) => ({ value: p.id, label: `${p.name} · ${p.domain}` }))}
                    value={projectIds}
                    onChange={setProjectIds}
                    placeholder="Select projects…"
                    label="Projects"
                    className="h-9 w-full"
                  />
                )}
              </div>

              <div className="flex items-start justify-between gap-3 rounded-xl border p-3">
                <div>
                  <Label htmlFor="invite-admin" className="flex items-center gap-1.5 text-sm">
                    <ShieldCheck className="size-4 text-brand" /> Make instance admin
                  </Label>
                  <p className="mt-0.5 text-xs text-muted-foreground">Grants access to this admin panel and all instance settings.</p>
                </div>
                <Switch id="invite-admin" checked={makeAdmin} onCheckedChange={setMakeAdmin} />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="invite-message">
                  Personal message <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <Textarea
                  id="invite-message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Hi! Join us to track our AI visibility…"
                  rows={3}
                  maxLength={2000}
                />
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button onClick={submit} disabled={busy || !valid.length || !workspaceId}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <MailPlus className="size-4" />}
                  {valid.length > 1 ? `Send ${valid.length} invitations` : "Send invitation"}
                </Button>
              </DialogFooter>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}
