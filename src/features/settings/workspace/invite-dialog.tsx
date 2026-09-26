"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, MailPlus, ShieldCheck, Terminal, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChipsInput } from "@/features/admin/components/settings-kit";
import { inviteMembersAction } from "../actions";
import { emailProblem } from "./domain-check";
import { ProjectPicker, type PickerProject } from "./project-picker";
import type { RoleInfo } from "./queries";

type Result = { email: string; ok: boolean; error?: string; transport?: "smtp" | "log" };

export function InviteDialog({
  workspaceId,
  workspaceName,
  roles,
  projects,
  allowedDomains,
  assignable,
  defaultRoleKey = "member",
  children,
}: {
  workspaceId: string;
  workspaceName: string;
  roles: RoleInfo[];
  projects: PickerProject[];
  allowedDomains: string[];
  /** Role keys the current user may grant. */
  assignable: string[];
  defaultRoleKey?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [emails, setEmails] = useState<string[]>([]);
  const [roleKey, setRoleKey] = useState(assignable.includes(defaultRoleKey) ? defaultRoleKey : (assignable[0] ?? ""));
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Result[] | null>(null);
  const role = roles.find((r) => r.key === roleKey);
  const needsProjects = role ? !(role.allProjects || role.permissions.includes("projects.all")) : false;

  const reset = () => {
    setEmails([]);
    setProjectIds([]);
    setMessage("");
    setResults(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MailPlus className="size-4 text-brand" /> Invite to {workspaceName}
          </DialogTitle>
          <DialogDescription>
            Invitees get a magic sign-in link by email. No passwords — the link proves they own the address.
          </DialogDescription>
        </DialogHeader>

        {results ? (
          <div className="space-y-2">
            {results.map((r) => (
              <div key={r.email} className="flex items-start gap-2 rounded-lg border px-3 py-2 text-sm">
                {r.ok ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                ) : (
                  <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                )}
                <div className="min-w-0">
                  <div className="truncate font-medium">{r.email}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.ok ? (r.transport === "log" ? "Invitation created — email not sent (SMTP not configured)." : "Invitation sent.") : r.error}
                  </div>
                </div>
              </div>
            ))}
            {results.some((r) => r.ok && r.transport === "log") && (
              <p className="flex items-start gap-2 rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
                <Terminal className="mt-0.5 size-3.5 shrink-0" />
                Email delivery isn&apos;t configured. Use “Copy link” in Pending invitations to share the link manually, or
                ask an admin to set up SMTP in Admin → Email.
              </p>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={reset}>
                Invite more
              </Button>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!emails.length) return void toast.error("Add at least one email address.");
              setBusy(true);
              try {
                const res = await inviteMembersAction({
                  workspaceId,
                  emails,
                  roleKey,
                  projectIds: needsProjects ? projectIds : [],
                  message: message.trim() || null,
                });
                if (!res.ok) return void toast.error(res.error);
                setResults(res.data);
                const okCount = res.data.filter((r) => r.ok).length;
                if (okCount) toast.success(`${okCount} ${okCount === 1 ? "invitation" : "invitations"} created`);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="invite-emails">Email addresses</Label>
              <ChipsInput
                id="invite-emails"
                value={emails}
                onChange={setEmails}
                placeholder="name@company.com, …"
                normalize={(s) => s.trim().toLowerCase()}
                validate={(s) => emailProblem(s, allowedDomains)}
              />
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <ShieldCheck className="size-3.5 text-brand" />
                {allowedDomains.length
                  ? `Only ${allowedDomains.map((d) => `@${d}`).join(", ")} addresses can be invited.`
                  : "Any email domain can be invited on this instance."}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={roleKey} onValueChange={setRoleKey}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose a role" />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r.key} value={r.key} disabled={!assignable.includes(r.key)}>
                      <span className="font-medium">{r.name}</span>
                      {r.description && <span className="ml-1 hidden text-xs text-muted-foreground sm:inline">— {r.description}</span>}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {needsProjects && (
              <div className="space-y-1.5">
                <Label>Project access</Label>
                <p className="text-xs text-muted-foreground">
                  {role?.name} members only see the projects you select here.
                </p>
                <ProjectPicker projects={projects} value={projectIds} onChange={setProjectIds} />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="invite-msg">Personal message (optional)</Label>
              <Textarea
                id="invite-msg"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={1000}
                rows={3}
                placeholder="Hi! Join us to track our AI visibility."
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !emails.length || !roleKey}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : `Send ${emails.length > 1 ? `${emails.length} invitations` : "invitation"}`}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
