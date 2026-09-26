"use client";

import { X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/ui/button";

/** Floating bottom-center bulk action bar ("N selected", actions, clear). */
export function BulkBar({ count, onClear, children }: { count: number; onClear: () => void; children: React.ReactNode }) {
  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.div
          initial={{ y: 24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 24, opacity: 0 }}
          transition={{ type: "spring", stiffness: 420, damping: 32 }}
          className="fixed inset-x-3 bottom-4 z-40 mx-auto flex max-w-fit flex-wrap items-center justify-center gap-2 rounded-2xl border bg-popover/95 px-3 py-2 shadow-lg backdrop-blur sm:inset-x-0"
        >
          <span className="px-1 text-sm font-medium tabular">{count} selected</span>
          <div className="flex flex-wrap items-center gap-1.5">{children}</div>
          <Button variant="ghost" size="icon-sm" onClick={onClear} aria-label="Clear selection">
            <X />
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
