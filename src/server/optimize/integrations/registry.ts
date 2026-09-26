import "server-only";
import type { CmsClient, PmClient } from "./types";
import type { Creds, Target } from "./providers/common";
import { createLinearClient } from "./providers/linear";
import { createJiraClient } from "./providers/jira";
import { createAsanaClient } from "./providers/asana";
import { createClickUpClient } from "./providers/clickup";
import { createTrelloClient } from "./providers/trello";
import { createMondayClient } from "./providers/monday";
import { createNotionClient } from "./providers/notion";
import { createAworkClient } from "./providers/awork";
import { createWebhookClient } from "./providers/webhook";
import { createWordPressClient } from "./providers/wordpress";
import { createWebflowClient } from "./providers/webflow";
import { createShopifyClient } from "./providers/shopify";
import { createFramerClient } from "./providers/framer";

export {
  PM_PROVIDERS,
  CMS_PROVIDERS,
  OPTIMIZE_PROVIDER_KEYS,
  getProviderMeta,
  isOptimizeProvider,
  resolveProviderKey,
} from "@/features/optimize/integrations/providers";

export function createPmClient(provider: string, creds: Creds, target: Target): PmClient {
  switch (provider) {
    case "linear":
      return createLinearClient(creds, target);
    case "jira":
      return createJiraClient(creds, target);
    case "asana":
      return createAsanaClient(creds, target);
    case "clickup":
      return createClickUpClient(creds, target);
    case "trello":
      return createTrelloClient(creds, target);
    case "monday":
      return createMondayClient(creds, target);
    case "notion":
      return createNotionClient(creds, target);
    case "awork":
      return createAworkClient(creds, target);
    case "webhook":
      return createWebhookClient(creds);
    default:
      throw new Error(`Unknown PM provider "${provider}".`);
  }
}

export function createCmsClient(provider: string, creds: Creds, target: Target): CmsClient {
  switch (provider) {
    case "wordpress":
      return createWordPressClient(creds);
    case "webflow":
      return createWebflowClient(creds, target);
    case "shopify_cms":
      return createShopifyClient(creds, target);
    case "framer":
      return createFramerClient(creds);
    default:
      throw new Error(`Unknown CMS provider "${provider}".`);
  }
}
