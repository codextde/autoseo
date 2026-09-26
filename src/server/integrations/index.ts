import "server-only";
/**
 * Public helpers of the integrations store for other modules (attribution, optimize, reports, MCP…).
 *
 *   const row = await getIntegration(projectId, "linear");
 *   const secret = await getIntegrationSecret<{ apiKey: string }>(projectId, "linear");
 *   await saveIntegration({ projectId, provider: "linear", config: { teamId }, secret: { apiKey } });
 *
 * Provider keys: see `INTEGRATIONS` in `src/lib/integrations-catalog.ts`.
 */
export {
  getIntegration,
  getIntegrationSecret,
  saveIntegration,
  listIntegrations,
  deleteIntegration,
  markIntegrationSync,
  issueIngestToken,
  findIntegrationByToken,
  revokeIngestToken,
  toPublicIntegration,
  readSecret,
  INGEST_TOKEN_PREFIX,
  type IntegrationRow,
  type PublicIntegration,
  type SaveIntegrationInput,
} from "./store";
export { getGoogleAccessToken, GoogleNotConnectedError, GoogleReconnectRequiredError } from "./google/oauth";
