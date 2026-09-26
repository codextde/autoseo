import "server-only";
import type { DemoModule, DemoPostStep } from "./context";
import analytics from "./analytics";
import attribution from "./attribution";
import audit from "./audit";
import seo from "./seo";
import workspaceContent, { postSteps as workspaceContentSteps } from "./workspace-content";

/** Per-module demo generators, run in the demo transaction after the core AI visibility data. */
export const DEMO_MODULES: DemoModule[] = [analytics, seo, audit, attribution, workspaceContent];

/** Service-based steps (reports, task generation) run after the transaction commits. */
export const DEMO_POST_STEPS: DemoPostStep[] = [...workspaceContentSteps];
