import { getApiProject } from "@/server/api/auth";
import { apiRoute, parseQuery } from "@/server/api/handler";
import { getAnswerContent } from "@/server/api/ai-data";
import { answerQuery } from "@/server/api/schemas";
import { corsPreflight } from "@/server/api/urls";

/** GET /api/v1/projects/{projectId}/answers/{answerId} — full AI answer with mentions and citations. */
export const GET = apiRoute<{ projectId: string; answerId: string }>({ scope: "read" }, async ({ principal, params, url }) => {
  const project = await getApiProject(principal, params.projectId);
  const q = parseQuery(url, answerQuery);
  return { data: await getAnswerContent(project, { answerId: params.answerId, maxChars: q.maxChars ?? 200_000 }) };
});

export const OPTIONS = corsPreflight;
