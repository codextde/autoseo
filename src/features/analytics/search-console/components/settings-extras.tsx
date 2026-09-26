"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { refineIntentsAction } from "../actions";

export function RefineIntentsButton({ projectId, disabled }: { projectId: string; disabled?: boolean }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending || disabled}
      onClick={() =>
        start(async () => {
          const res = await refineIntentsAction(projectId);
          if (res.ok)
            toast.success(
              res.data.alreadyQueued ? "Intent refinement is already running." : "Classifying your top queries with AI — labels update in a few minutes.",
            );
          else toast.error(res.error);
        })
      }
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
      Refine intents with AI
    </Button>
  );
}
