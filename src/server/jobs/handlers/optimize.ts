import "server-only";
// Job handlers + schedules for the "optimize" module (Tasks, Content, Fact Check, PM/CMS integrations).
// Each sub-module registers its own jobs with defineJob / defineSchedule.
import "@/server/optimize/tasks/jobs";
import "@/server/optimize/content/jobs";
import "@/server/optimize/fact-check/jobs";
import "@/server/optimize/integrations/jobs";
