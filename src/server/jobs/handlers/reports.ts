import "server-only";
// Job handlers + schedules for the "reports" module (use defineJob / defineSchedule from ../define).
import { and, eq, inArray, lt } from "drizzle-orm";
import { db } from "@/server/db/client";
import { reports } from "@/server/db/schema";
import { defineJob, defineSchedule } from "../define";
import { agentDesignSlide, agentRewrite, agentSummarize, generateHtmlReport } from "@/server/reports/ai";
import { loadReportData } from "@/server/reports/data";
import type { DateRangeValue } from "@/features/reports/lib/types";

/** Agent-written, self-contained HTML report (open-seo style). */
defineJob<{ reportId: string }>({
  type: "reports.generate_html",
  concurrency: 2,
  timeoutMs: 20 * 60_000,
  retryable: false,
  run: async ({ reportId }, ctx) => {
    await ctx.progress({ step: "writing" });
    return generateHtmlReport(reportId, { isCancelled: ctx.isCancelled });
  },
});

export type ReportAgentPayload = {
  projectId: string;
  workspaceId: string;
  userId: string;
  action: "slide" | "rewrite" | "summarize";
  prompt?: string;
  markup?: string;
  instruction?: string;
  focus?: string;
  dateRange?: DateRangeValue;
  /** Project whose data the deck currently shows ("one deck, every client"). */
  dataProjectId?: string;
  size?: { w: number; h: number };
};

/** Editor "Agent" panel: design a slide, rewrite copy, summarize findings. Result is polled by the editor. */
defineJob<ReportAgentPayload>({
  type: "reports.agent",
  concurrency: 3,
  timeoutMs: 10 * 60_000,
  retryable: false,
  run: async (p, ctx) => {
    await ctx.progress({ step: "loading data" });
    const bundle = await loadReportData(p.dataProjectId ?? p.projectId, p.dateRange);
    await ctx.progress({ step: "thinking" });
    const base = { projectId: p.projectId, workspaceId: p.workspaceId, userId: p.userId, bundle };
    if (p.action === "slide") {
      const { slide, provider } = await agentDesignSlide({ ...base, prompt: p.prompt ?? "", size: p.size ?? { w: 1920, h: 1080 } });
      return { kind: "slide", slide, provider };
    }
    if (p.action === "rewrite") {
      return { kind: "text", text: await agentRewrite({ ...base, markup: p.markup ?? "", instruction: p.instruction ?? "Make it clearer." }) };
    }
    return { kind: "text", text: await agentSummarize({ ...base, focus: p.focus }) };
  },
});

/** Marks AI HTML reports stuck in queued/running (e.g. after a crash) as failed so they can be retried. */
defineSchedule({
  name: "reports.recover_stuck",
  cron: "*/15 * * * *",
  tick: async () => {
    await db
      .update(reports)
      .set({ aiStatus: "failed", aiError: "Generation did not finish. Try again." })
      .where(and(eq(reports.kind, "html"), inArray(reports.aiStatus, ["queued", "running"]), lt(reports.updatedAt, new Date(Date.now() - 60 * 60_000))));
  },
});
