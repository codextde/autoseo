import "server-only";
import { S, type OpenApiOperation } from "../openapi-helpers";
import {
  addToTrackerInput,
  brandLookupInput,
  generateResearchInput,
  lookupResultQuery,
  lookupsQuery,
  promptExplorerInput,
  researchItemsQuery,
} from "../research";

const { str, strN, num, int, bool, arr, obj } = S;
const pagination = obj({ page: int, limit: int, total: int, totalPages: int });

const started = obj({ lookupId: str, kind: str, status: { type: "string", enum: ["queued", "running", "done", "failed"] }, params: { type: "object" } });
const researchList = obj({ id: str, name: str, isDefault: bool, source: str, status: { type: "string", enum: ["idle", "generating", "failed"] }, jobId: strN, error: strN, itemCount: int, createdAt: str });

/** REST v1 operations: brand lookup, prompt explorer and prompt research (ai-research module). */
export const researchOperations: OpenApiOperation[] = [
  {
    method: "post",
    path: "/projects/{projectId}/research/brand-lookup",
    operationId: "startBrandLookup",
    summary: "Start brand lookup",
    description:
      "ChatGPT / Google AI Overview mentions of a brand or domain (top pages, top AI questions, share of voice vs up to 5 competitors). Paid DataForSEO call (~$0.85 + $0.20 per competitor), runs in the background (202) — poll GET /research/lookups/{lookupId}. Requires the `seo.run` permission.",
    tag: "AI research",
    scope: "read",
    permission: "seo.run",
    body: brandLookupInput,
    status: 202,
    data: started,
  },
  {
    method: "post",
    path: "/projects/{projectId}/research/prompt-explorer",
    operationId: "startPromptExplorer",
    summary: "Ask a prompt to AI models",
    description:
      "Asks one prompt to ChatGPT, Claude, Gemini, Perplexity (DataForSEO) and/or the local agent / AI API (`autoseo`) and records answers, citations and brand mentions. Paid; runs in the background (202) — poll GET /research/lookups/{lookupId}. Requires `seo.run`.",
    tag: "AI research",
    scope: "read",
    permission: "seo.run",
    body: promptExplorerInput,
    status: 202,
    data: started,
  },
  {
    method: "get",
    path: "/projects/{projectId}/research/lookups",
    operationId: "listLookups",
    summary: "Lookup history",
    tag: "AI research",
    scope: "read",
    query: lookupsQuery,
    data: arr(obj({ id: str, kind: str, query: str, status: str, error: strN, costUsd: num, createdAt: str, params: { type: "object" }, createdByName: strN })),
  },
  {
    method: "get",
    path: "/projects/{projectId}/research/lookups/{lookupId}",
    operationId: "getLookup",
    summary: "Lookup status & result",
    description: "`result` is a brand lookup result or the prompt-explorer answers once `status` is done (null before).",
    tag: "AI research",
    scope: "read",
    query: lookupResultQuery,
    data: obj({ lookupId: str, kind: str, query: str, status: str, error: strN, costUsd: num, params: { type: "object" }, createdAt: str, finishedAt: strN, result: { type: ["object", "null"] } }),
  },
  { method: "get", path: "/projects/{projectId}/research/prompt-lists", operationId: "listPromptLists", summary: "Prompt research lists", tag: "AI research", scope: "read", data: arr(researchList) },
  {
    method: "get",
    path: "/projects/{projectId}/research/prompt-lists/{listId}/items",
    operationId: "listPromptListItems",
    summary: "Prompt research items",
    tag: "AI research",
    scope: "read",
    query: researchItemsQuery.omit({ listId: true }),
    data: arr(
      obj({
        id: str,
        text: str,
        topic: strN,
        funnelStage: strN,
        persona: strN,
        intent: strN,
        branded: bool,
        competitorMentioned: strN,
        length: strN,
        volume: num,
        volumeScore: num,
        volumeSource: strN,
        keyword: strN,
        trackedPromptId: strN,
        source: str,
        createdAt: str,
      }),
    ),
    meta: { list: researchList, pagination },
  },
  {
    method: "post",
    path: "/projects/{projectId}/research/prompt-lists/generate",
    operationId: "generatePromptResearch",
    summary: "Generate prompt research",
    description: "AI prompt-set generation into a new or existing list (job, 202). Uses the local agent / AI API.",
    tag: "AI research",
    scope: "write",
    permission: "prompts.manage",
    body: generateResearchInput,
    status: 202,
    data: obj({ listId: str, listName: str, jobId: strN, status: str, count: int }),
  },
  {
    method: "post",
    path: "/projects/{projectId}/research/prompt-lists/track",
    operationId: "trackResearchPrompts",
    summary: "Track researched prompts",
    description: "Adds research items to AI visibility tracking (existing identical prompts are linked).",
    tag: "AI research",
    scope: "write",
    permission: "prompts.manage",
    body: addToTrackerInput,
    data: obj({ added: int, linked: int, skippedOverLimit: int }),
  },
];
