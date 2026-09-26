"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createDemoProjectAction } from "../../actions";

/** "Explore with demo data" — creates a labelled demo project and opens it. */
export function DemoDataButton({ projectId, variant = "default", className }: { projectId: string; variant?: "default" | "outline"; className?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant={variant}
      className={className}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const toastId = toast.loading("Generating 90 days of demo data…");
          const res = await createDemoProjectAction(projectId);
          if (!res.ok) {
            toast.error(res.error, { id: toastId });
            return;
          }
          toast.success("Demo project ready", { id: toastId });
          router.push(`/p/${res.data.projectId}`);
        })
      }
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
      {pending ? "Generating demo…" : "Explore with demo data"}
    </Button>
  );
}
