"use client";

import { usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import { MessageCircle } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { sendFeedbackAction } from "@/features/shell/actions";
import { useShell } from "./shell-context";

export function FeedbackDialog() {
  const shell = useShell();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("feedback");
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button variant="ghost" size="icon" className="size-9" aria-label="Feedback">
              <MessageCircle className="size-[18px]" />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent>Feedback</TooltipContent>
      </Tooltip>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Send feedback</DialogTitle>
          <DialogDescription>Found a bug or have an idea? Admins see all feedback in the admin panel.</DialogDescription>
        </DialogHeader>
        <ToggleGroup type="single" value={kind} onValueChange={(v) => v && setKind(v)} variant="outline" className="w-full">
          <ToggleGroupItem value="feedback" className="flex-1">Feedback</ToggleGroupItem>
          <ToggleGroupItem value="bug" className="flex-1">Bug</ToggleGroupItem>
          <ToggleGroupItem value="idea" className="flex-1">Idea</ToggleGroupItem>
        </ToggleGroup>
        <Textarea rows={6} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Tell us what's on your mind…" />
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={pending || message.trim().length < 3}
            onClick={() =>
              start(async () => {
                const r = await sendFeedbackAction({ message, kind, path: pathname, projectId: shell.currentProjectId });
                if (!r.ok) return void toast.error(r.error);
                toast.success("Thanks for your feedback!");
                setMessage("");
                setOpen(false);
              })
            }
          >
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
