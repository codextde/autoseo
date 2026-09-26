import "server-only";
import type { JobContext } from "@/server/jobs/types";
import { processUploadFile } from "./uploads";

/** Job handler for large log uploads (> 50 MB). */
export async function processLogUpload(payload: { uploadId: string }, ctx?: JobContext): Promise<unknown> {
  const row = await processUploadFile(payload.uploadId, {
    onProgress: ctx ? ({ percent, lines }) => ctx.progress({ percent, lines }) : undefined,
    isCancelled: ctx ? () => ctx.isCancelled() : undefined,
  });
  return {
    uploadId: row.id,
    totalLines: row.totalLines,
    parsedLines: row.parsedLines,
    botVisits: row.botVisits,
    saved: row.saved,
  };
}
