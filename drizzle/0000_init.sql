CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"scopes" jsonb DEFAULT '["read"]'::jsonb NOT NULL,
	"project_ids" jsonb,
	"kind" text DEFAULT 'api' NOT NULL,
	"oauth_client_id" text,
	"request_count" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_request_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"api_key_id" text,
	"workspace_id" text,
	"path" text NOT NULL,
	"method" text NOT NULL,
	"status" integer NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb,
	"secret" text,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_id" text,
	"actor_email" text,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"workspace_id" text,
	"project_id" text,
	"ip" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookmarks" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"project_id" text,
	"name" text NOT NULL,
	"path" text NOT NULL,
	"shared" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"project_id" text,
	"kind" text DEFAULT 'feedback' NOT NULL,
	"message" text NOT NULL,
	"path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"provider" text NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secret" text,
	"token_hash" text,
	"token_prefix" text,
	"connected_by" text,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"email" text NOT NULL,
	"role_key" text NOT NULL,
	"project_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"make_instance_admin" boolean DEFAULT false NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" text,
	"message" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"last_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"dedupe_key" text,
	"locked_by" text,
	"locked_at" timestamp with time zone,
	"progress" jsonb,
	"result" jsonb,
	"last_error" text,
	"project_id" text,
	"workspace_id" text,
	"created_by" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"user_id" text,
	"token_hash" text NOT NULL,
	"code_hash" text,
	"purpose" text DEFAULT 'login' NOT NULL,
	"redirect_to" text,
	"request_ip" text,
	"request_user_agent" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"project_id" text,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"href" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_members" (
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_members_project_id_user_id_pk" PRIMARY KEY("project_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "project_shares" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"email" text NOT NULL,
	"role_key" text DEFAULT 'client' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"invited_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"domain" text NOT NULL,
	"website_url" text,
	"logo_url" text,
	"description" text,
	"country" text DEFAULT 'US' NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"brand" jsonb DEFAULT '{"aliases":[],"domains":[]}'::jsonb NOT NULL,
	"is_pitch" boolean DEFAULT false NOT NULL,
	"pitch_expires_at" timestamp with time zone,
	"archived" boolean DEFAULT false NOT NULL,
	"engines" jsonb DEFAULT '["chatgpt","perplexity","ai_overview"]'::jsonb NOT NULL,
	"tracking_frequency" text DEFAULT 'daily' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"onboarding_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"builtin" boolean DEFAULT false NOT NULL,
	"all_projects" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"user_agent" text,
	"ip" text,
	"device_label" text,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text,
	"project_id" text,
	"user_id" text,
	"provider" text NOT NULL,
	"feature" text NOT NULL,
	"endpoint" text,
	"units" integer DEFAULT 1 NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"avatar_url" text,
	"is_instance_admin" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"last_project_id" text,
	"last_login_at" timestamp with time zone,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_members_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo_url" text,
	"branding" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspaces_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "agent_chat_events" (
	"seq" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "agent_chat_events_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"job_id" text NOT NULL,
	"type" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_checkins" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"agent_version" text,
	"hostname" text,
	"os" text,
	"os_release" text,
	"arch" text,
	"node_version" text,
	"claude_version" text,
	"codex_version" text,
	"effective_runtime" text,
	"running_jobs" integer DEFAULT 0 NOT NULL,
	"ip" text,
	"fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_events" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"job_id" text,
	"type" text NOT NULL,
	"level" text DEFAULT 'info' NOT NULL,
	"message" text NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_job_logs" (
	"seq" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "agent_job_logs_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"agent_id" text NOT NULL,
	"job_id" text,
	"stream" text NOT NULL,
	"data" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text,
	"project_id" text,
	"user_id" text,
	"kind" text NOT NULL,
	"purpose" text NOT NULL,
	"runtime" text DEFAULT 'any' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"pinned_agent_id" text,
	"agent_id" text,
	"excluded_agent_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 2 NOT NULL,
	"timeout_ms" integer NOT NULL,
	"expires_at" timestamp with time zone,
	"cancel_requested_at" timestamp with time zone,
	"cancelled_by" text,
	"runtime_used" text,
	"cli_mode" text,
	"cli_version" text,
	"model" text,
	"work_dir" text,
	"result_text" text,
	"result_json" jsonb,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"usage" jsonb,
	"exit_code" integer,
	"error" text,
	"log_bytes" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text,
	"created_by" text,
	"name" text NOT NULL,
	"labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"token_issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reinstall_count" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"runtime" text,
	"work_dir" text,
	"max_parallel" integer,
	"auto_update" boolean DEFAULT true NOT NULL,
	"allowed_kinds" jsonb DEFAULT '["llm","web-search","chat","test"]'::jsonb NOT NULL,
	"cli_profile" text DEFAULT 'auto' NOT NULL,
	"shared" boolean DEFAULT false NOT NULL,
	"agent_version" text,
	"hostname" text,
	"os" text,
	"os_release" text,
	"arch" text,
	"node_version" text,
	"claude_version" text,
	"codex_version" text,
	"effective_runtime" text,
	"local_flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"effective_work_dir" text,
	"effective_max_parallel" integer,
	"running_jobs" integer DEFAULT 0 NOT NULL,
	"work_dir_bytes" bigint,
	"state" text DEFAULT 'idle' NOT NULL,
	"last_ip" text,
	"first_checkin_at" timestamp with time zone,
	"last_checkin_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"offline_since" timestamp with time zone,
	"update_requested_at" timestamp with time zone,
	"update_requested_by" text,
	"updating_to_version" text,
	"update_started_at" timestamp with time zone,
	"last_updated_at" timestamp with time zone,
	"commands" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_cleanup_at" timestamp with time zone,
	"last_cleanup_freed_bytes" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_ad_appearances" (
	"id" text PRIMARY KEY NOT NULL,
	"ad_id" text NOT NULL,
	"answer_id" text NOT NULL,
	"project_id" text NOT NULL,
	"prompt_id" text NOT NULL,
	"engine" text NOT NULL,
	"answer_date" date NOT NULL,
	"position" integer,
	"rating" double precision
);
--> statement-breakpoint
CREATE TABLE "ai_ads" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"advertiser" text NOT NULL,
	"advertiser_domain" text,
	"competitor_id" text,
	"is_own" boolean DEFAULT false NOT NULL,
	"headline" text NOT NULL,
	"description" text,
	"image_url" text,
	"landing_url" text,
	"fingerprint" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_answers" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"prompt_id" text NOT NULL,
	"run_id" text,
	"engine" text NOT NULL,
	"provider" text NOT NULL,
	"model" text,
	"country" text NOT NULL,
	"language" text NOT NULL,
	"answer_date" date NOT NULL,
	"status" text DEFAULT 'ok' NOT NULL,
	"error" text,
	"text" text DEFAULT '' NOT NULL,
	"raw" jsonb,
	"duration_ms" integer,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"brand_mentioned" boolean DEFAULT false NOT NULL,
	"brand_cited" boolean DEFAULT false NOT NULL,
	"brand_position" integer,
	"mention_depth" double precision,
	"sentiment" double precision,
	"brand_count" integer DEFAULT 0 NOT NULL,
	"citation_count" integer DEFAULT 0 NOT NULL,
	"own_citation_count" integer DEFAULT 0 NOT NULL,
	"analysis_status" text DEFAULT 'pending' NOT NULL,
	"analysis_error" text,
	"analyzed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_citations" (
	"id" text PRIMARY KEY NOT NULL,
	"answer_id" text NOT NULL,
	"source_id" text NOT NULL,
	"project_id" text NOT NULL,
	"prompt_id" text NOT NULL,
	"engine" text NOT NULL,
	"answer_date" date NOT NULL,
	"position" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_fanouts" (
	"id" text PRIMARY KEY NOT NULL,
	"answer_id" text NOT NULL,
	"project_id" text NOT NULL,
	"prompt_id" text NOT NULL,
	"engine" text NOT NULL,
	"answer_date" date NOT NULL,
	"query" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_lookups" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"kind" text NOT NULL,
	"query" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"created_by" text,
	"status" text DEFAULT 'done' NOT NULL,
	"error" text,
	"job_id" text,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_mentions" (
	"id" text PRIMARY KEY NOT NULL,
	"answer_id" text NOT NULL,
	"project_id" text NOT NULL,
	"prompt_id" text NOT NULL,
	"engine" text NOT NULL,
	"answer_date" date NOT NULL,
	"competitor_id" text,
	"is_own" boolean DEFAULT false NOT NULL,
	"brand_name" text NOT NULL,
	"position" integer NOT NULL,
	"char_offset" integer DEFAULT 0 NOT NULL,
	"depth_pct" double precision DEFAULT 0 NOT NULL,
	"occurrences" integer DEFAULT 1 NOT NULL,
	"cited" boolean DEFAULT false NOT NULL,
	"sentiment" double precision,
	"recommended" boolean DEFAULT false NOT NULL,
	"snippet" text
);
--> statement-breakpoint
CREATE TABLE "ai_product_appearances" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"answer_id" text NOT NULL,
	"project_id" text NOT NULL,
	"prompt_id" text NOT NULL,
	"engine" text NOT NULL,
	"answer_date" date NOT NULL,
	"source" text DEFAULT 'llm' NOT NULL,
	"position" integer,
	"price" double precision,
	"old_price" double precision,
	"currency" text,
	"rating" double precision,
	"reviews" integer,
	"store" text,
	"store_domain" text,
	"url" text
);
--> statement-breakpoint
CREATE TABLE "ai_products" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"brand_name" text,
	"competitor_id" text,
	"is_own" boolean DEFAULT false NOT NULL,
	"category" text,
	"image_url" text,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_recommendations" (
	"id" text PRIMARY KEY NOT NULL,
	"answer_id" text NOT NULL,
	"project_id" text NOT NULL,
	"prompt_id" text NOT NULL,
	"engine" text NOT NULL,
	"answer_date" date NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"competitor_id" text,
	"is_own" boolean DEFAULT false NOT NULL,
	"brand_name" text NOT NULL,
	"opponent_competitor_id" text,
	"opponent_is_own" boolean,
	"opponent_name" text,
	"winner" text
);
--> statement-breakpoint
CREATE TABLE "ai_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"trigger" text DEFAULT 'schedule' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"total_tasks" integer DEFAULT 0 NOT NULL,
	"done_tasks" integer DEFAULT 0 NOT NULL,
	"failed_tasks" integer DEFAULT 0 NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"full_run" boolean DEFAULT true NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"created_by" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"url" text NOT NULL,
	"domain" text NOT NULL,
	"title" text,
	"content_type" text DEFAULT 'other' NOT NULL,
	"ownership" text DEFAULT 'third_party' NOT NULL,
	"competitor_id" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_statements" (
	"id" text PRIMARY KEY NOT NULL,
	"answer_id" text NOT NULL,
	"project_id" text NOT NULL,
	"prompt_id" text NOT NULL,
	"engine" text NOT NULL,
	"answer_date" date NOT NULL,
	"competitor_id" text,
	"is_own" boolean DEFAULT false NOT NULL,
	"brand_name" text NOT NULL,
	"polarity" text NOT NULL,
	"theme" text,
	"attribute" text,
	"quote" text NOT NULL,
	"severity" double precision DEFAULT 50 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brand_knowledge" (
	"project_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"job_id" text,
	"requested_by" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_knowledge_project_id_kind_pk" PRIMARY KEY("project_id","kind")
);
--> statement-breakpoint
CREATE TABLE "catalog_products" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"sku" text,
	"name" text NOT NULL,
	"url" text,
	"image_url" text,
	"price" double precision,
	"currency" text,
	"category" text,
	"brand" text,
	"description" text,
	"product_key" text,
	"gtin" text,
	"availability" text,
	"source" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competitors" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"domain" text,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"logo_url" text,
	"color" text,
	"tracked" boolean DEFAULT true NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_context_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"updated_by" text DEFAULT 'user' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_research_items" (
	"id" text PRIMARY KEY NOT NULL,
	"list_id" text NOT NULL,
	"project_id" text NOT NULL,
	"text" text NOT NULL,
	"topic" text,
	"funnel_stage" text,
	"persona" text,
	"intent" text,
	"branded" boolean DEFAULT false NOT NULL,
	"competitor_mentioned" text,
	"length" text,
	"volume_score" double precision,
	"volume" integer,
	"tracked_prompt_id" text,
	"added_at" timestamp with time zone,
	"volume_source" text,
	"keyword" text,
	"source" text DEFAULT 'generated' NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_research_lists" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'generated' NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"job_id" text,
	"error" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_tag_links" (
	"prompt_id" text NOT NULL,
	"tag_id" text NOT NULL,
	CONSTRAINT "prompt_tag_links_prompt_id_tag_id_pk" PRIMARY KEY("prompt_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "prompt_tags" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompts" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"text" text NOT NULL,
	"country" text DEFAULT 'US' NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"topic" text,
	"funnel_stage" text,
	"intent" text,
	"persona" text,
	"branded" boolean DEFAULT false NOT NULL,
	"volume" integer,
	"source" text DEFAULT 'manual' NOT NULL,
	"engines" jsonb,
	"created_by" text,
	"last_run_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seo_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"namespace" text NOT NULL,
	"project_id" text,
	"value" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seo_keyword_metrics" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "seo_keyword_metrics_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"project_id" text NOT NULL,
	"keyword" text NOT NULL,
	"location_code" integer NOT NULL,
	"language_code" text DEFAULT 'en' NOT NULL,
	"search_volume" integer,
	"cpc" double precision,
	"competition" double precision,
	"keyword_difficulty" integer,
	"intent" text,
	"monthly_searches" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seo_local_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"tool" text NOT NULL,
	"label" text NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"result" jsonb,
	"error" text,
	"task_id" text,
	"task_endpoint" text,
	"collect_attempts" integer DEFAULT 0 NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"job_id" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "seo_rank_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"domain" text NOT NULL,
	"location_code" integer DEFAULT 2840 NOT NULL,
	"language_code" text DEFAULT 'en' NOT NULL,
	"location_name" text,
	"devices" text DEFAULT 'both' NOT NULL,
	"serp_depth" integer DEFAULT 40 NOT NULL,
	"schedule_interval" text DEFAULT 'weekly' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_checked_at" timestamp with time zone,
	"next_check_at" timestamp with time zone,
	"last_skip_reason" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seo_rank_keywords" (
	"id" text PRIMARY KEY NOT NULL,
	"config_id" text NOT NULL,
	"keyword" text NOT NULL,
	"match_case" boolean DEFAULT false NOT NULL,
	"search_volume" integer,
	"keyword_difficulty" integer,
	"cpc" double precision,
	"metrics_fetched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seo_rank_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"config_id" text NOT NULL,
	"project_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"trigger" text DEFAULT 'manual' NOT NULL,
	"method" text DEFAULT 'live' NOT NULL,
	"phase" text DEFAULT 'prepare' NOT NULL,
	"collect_round" integer DEFAULT 0 NOT NULL,
	"keywords_total" integer DEFAULT 0 NOT NULL,
	"keywords_checked" integer DEFAULT 0 NOT NULL,
	"is_subset_run" boolean DEFAULT false NOT NULL,
	"keyword_ids" jsonb,
	"error_message" text,
	"job_id" text,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "seo_rank_snapshots" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "seo_rank_snapshots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"run_id" text NOT NULL,
	"tracking_keyword_id" text NOT NULL,
	"keyword" text NOT NULL,
	"device" text NOT NULL,
	"position" integer,
	"url" text,
	"serp_features" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seo_rank_tasks" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "seo_rank_tasks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"run_id" text NOT NULL,
	"tracking_keyword_id" text NOT NULL,
	"keyword" text NOT NULL,
	"device" text NOT NULL,
	"task_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seo_kw_tag_links" (
	"saved_keyword_id" text NOT NULL,
	"tag_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seo_kw_tag_links_saved_keyword_id_tag_id_pk" PRIMARY KEY("saved_keyword_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "seo_saved_keyword_tags" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seo_saved_keywords" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"keyword" text NOT NULL,
	"location_code" integer DEFAULT 2840 NOT NULL,
	"language_code" text DEFAULT 'en' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seo_search_history" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"feature" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"label" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"kind" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"frequency" text DEFAULT 'weekly' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"next_run_at" timestamp with time zone NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_run_id" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crawlability_checks" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"trigger" text DEFAULT 'manual' NOT NULL,
	"origin" text NOT NULL,
	"urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"score" integer,
	"scores" jsonb,
	"result" jsonb,
	"progress" jsonb,
	"llms_txt_draft" text,
	"llms_txt_draft_source" text,
	"llms_txt_status" text DEFAULT 'idle' NOT NULL,
	"llms_txt_error" text,
	"error" text,
	"schedule_id" text,
	"created_by" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_audit_frontier" (
	"audit_id" text NOT NULL,
	"url" text NOT NULL,
	"depth" integer,
	"source" text NOT NULL,
	"in_sitemap" boolean DEFAULT false NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"seq" bigserial NOT NULL,
	CONSTRAINT "site_audit_frontier_audit_id_url_pk" PRIMARY KEY("audit_id","url")
);
--> statement-breakpoint
CREATE TABLE "site_audit_issues" (
	"id" text PRIMARY KEY NOT NULL,
	"audit_id" text NOT NULL,
	"page_id" text,
	"page_url" text NOT NULL,
	"issue_type" text NOT NULL,
	"severity" text NOT NULL,
	"category" text NOT NULL,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_audit_lighthouse" (
	"id" text PRIMARY KEY NOT NULL,
	"audit_id" text NOT NULL,
	"page_id" text,
	"url" text NOT NULL,
	"strategy" text NOT NULL,
	"provider" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"performance_score" integer,
	"accessibility_score" integer,
	"best_practices_score" integer,
	"seo_score" integer,
	"lcp_ms" double precision,
	"cls" double precision,
	"inp_ms" double precision,
	"ttfb_ms" double precision,
	"error_message" text,
	"payload" jsonb,
	"payload_size_bytes" integer,
	"cost_usd" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_audit_page_links" (
	"page_id" text PRIMARY KEY NOT NULL,
	"audit_id" text NOT NULL,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_audit_pages" (
	"id" text PRIMARY KEY NOT NULL,
	"audit_id" text NOT NULL,
	"url" text NOT NULL,
	"status_code" integer,
	"fetch_class" text DEFAULT 'ok' NOT NULL,
	"redirect_url" text,
	"content_type" text,
	"title" text,
	"meta_description" text,
	"canonical_url" text,
	"robots_meta" text,
	"x_robots_tag" text,
	"header_canonical_url" text,
	"og_title" text,
	"og_description" text,
	"og_image" text,
	"h1_count" integer DEFAULT 0 NOT NULL,
	"h2_count" integer DEFAULT 0 NOT NULL,
	"h3_count" integer DEFAULT 0 NOT NULL,
	"h4_count" integer DEFAULT 0 NOT NULL,
	"h5_count" integer DEFAULT 0 NOT NULL,
	"h6_count" integer DEFAULT 0 NOT NULL,
	"h1s" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"heading_order" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"word_count" integer DEFAULT 0 NOT NULL,
	"content_hash" text,
	"html_bytes" integer DEFAULT 0 NOT NULL,
	"images_total" integer DEFAULT 0 NOT NULL,
	"images_missing_alt" integer DEFAULT 0 NOT NULL,
	"images" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"internal_link_count" integer DEFAULT 0 NOT NULL,
	"external_link_count" integer DEFAULT 0 NOT NULL,
	"inlink_count" integer,
	"has_structured_data" boolean DEFAULT false NOT NULL,
	"structured_data_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"hreflang_tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"lang" text,
	"is_indexable" boolean DEFAULT false NOT NULL,
	"crawl_depth" integer,
	"in_sitemap" boolean DEFAULT false NOT NULL,
	"response_time_ms" integer DEFAULT 0 NOT NULL,
	"score" integer,
	"issue_count" integer DEFAULT 0 NOT NULL,
	"crawled_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_audits" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"start_url" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"current_phase" text DEFAULT 'queued' NOT NULL,
	"trigger" text DEFAULT 'manual' NOT NULL,
	"config" jsonb NOT NULL,
	"pages_crawled" integer DEFAULT 0 NOT NULL,
	"pages_total" integer DEFAULT 0 NOT NULL,
	"lighthouse_total" integer DEFAULT 0 NOT NULL,
	"lighthouse_completed" integer DEFAULT 0 NOT NULL,
	"lighthouse_failed" integer DEFAULT 0 NOT NULL,
	"score" integer,
	"issue_counts" jsonb,
	"avg_response_ms" integer,
	"crawl_completed" boolean DEFAULT false NOT NULL,
	"rate_limited" boolean DEFAULT false NOT NULL,
	"robots_txt" text,
	"robots_fetched" boolean DEFAULT false NOT NULL,
	"throttle_state" jsonb,
	"window_hint" integer,
	"chunk_no" integer DEFAULT 0 NOT NULL,
	"idle_chunks" integer DEFAULT 0 NOT NULL,
	"runner_id" text,
	"heartbeat_at" timestamp with time zone,
	"resume_count" integer DEFAULT 0 NOT NULL,
	"stop_requested" boolean DEFAULT false NOT NULL,
	"error_code" text,
	"error_detail" text,
	"failed_phase" text,
	"schedule_id" text,
	"created_by" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_bot_ip_ranges" (
	"key" text PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"prefixes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fetched_at" timestamp with time zone,
	"error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_bot_visits" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"bot" text NOT NULL,
	"company" text,
	"ts" timestamp with time zone NOT NULL,
	"ip" text,
	"host" text,
	"path" text NOT NULL,
	"method" text,
	"status" integer,
	"user_agent" text,
	"bytes" bigint,
	"verified" boolean,
	"source" text DEFAULT 'api' NOT NULL,
	"upload_id" text,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_google_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"sub" text NOT NULL,
	"email" text,
	"name" text,
	"picture" text,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"secret" text,
	"status" text DEFAULT 'active' NOT NULL,
	"last_error" text,
	"connected_by" text,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_gsc_inspections" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"site_url" text NOT NULL,
	"url" text NOT NULL,
	"verdict" text,
	"coverage_state" text,
	"result" jsonb,
	"error" text,
	"api_call" boolean DEFAULT true NOT NULL,
	"inspected_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_log_ingest_stats" (
	"project_id" text NOT NULL,
	"source" text NOT NULL,
	"date" date NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"lines" integer DEFAULT 0 NOT NULL,
	"bot_visits" integer DEFAULT 0 NOT NULL,
	"saved" integer DEFAULT 0 NOT NULL,
	"last_received_at" timestamp with time zone,
	CONSTRAINT "analytics_log_ingest_stats_project_id_source_date_pk" PRIMARY KEY("project_id","source","date")
);
--> statement-breakpoint
CREATE TABLE "analytics_log_uploads" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"filename" text NOT NULL,
	"size_bytes" bigint DEFAULT 0 NOT NULL,
	"received_bytes" bigint DEFAULT 0 NOT NULL,
	"format" text DEFAULT 'auto' NOT NULL,
	"detected_format" text,
	"status" text DEFAULT 'uploading' NOT NULL,
	"total_lines" integer DEFAULT 0 NOT NULL,
	"parsed_lines" integer DEFAULT 0 NOT NULL,
	"invalid_lines" integer DEFAULT 0 NOT NULL,
	"bot_visits" integer DEFAULT 0 NOT NULL,
	"saved" integer DEFAULT 0 NOT NULL,
	"error" text,
	"job_id" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "analytics_sc_daily" (
	"project_id" text NOT NULL,
	"source" text NOT NULL,
	"date" date NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"position" double precision,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_sc_daily_project_id_source_date_pk" PRIMARY KEY("project_id","source","date")
);
--> statement-breakpoint
CREATE TABLE "analytics_sc_pages" (
	"project_id" text NOT NULL,
	"source" text NOT NULL,
	"date" date NOT NULL,
	"page" text NOT NULL,
	"query" text DEFAULT '' NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"position" double precision
);
--> statement-breakpoint
CREATE TABLE "analytics_sc_queries" (
	"project_id" text NOT NULL,
	"source" text NOT NULL,
	"date" date NOT NULL,
	"query" text NOT NULL,
	"country" text DEFAULT '' NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"position" double precision
);
--> statement-breakpoint
CREATE TABLE "analytics_sc_query_intents" (
	"project_id" text NOT NULL,
	"query" text NOT NULL,
	"intent" text NOT NULL,
	"is_prompt" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'llm' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_sc_query_intents_project_id_query_pk" PRIMARY KEY("project_id","query")
);
--> statement-breakpoint
CREATE TABLE "analytics_traffic_daily" (
	"project_id" text NOT NULL,
	"provider" text NOT NULL,
	"date" date NOT NULL,
	"sessions" integer DEFAULT 0 NOT NULL,
	"conversions" double precision DEFAULT 0 NOT NULL,
	"revenue" double precision DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_traffic_daily_project_id_provider_date_pk" PRIMARY KEY("project_id","provider","date")
);
--> statement-breakpoint
CREATE TABLE "analytics_traffic_rows" (
	"project_id" text NOT NULL,
	"provider" text NOT NULL,
	"date" date NOT NULL,
	"platform" text NOT NULL,
	"page" text DEFAULT '' NOT NULL,
	"country" text DEFAULT '' NOT NULL,
	"sessions" integer DEFAULT 0 NOT NULL,
	"engaged_sessions" integer DEFAULT 0 NOT NULL,
	"converted_sessions" double precision DEFAULT 0 NOT NULL,
	"conversions" double precision DEFAULT 0 NOT NULL,
	"revenue" double precision DEFAULT 0 NOT NULL,
	"engagement_seconds" double precision DEFAULT 0 NOT NULL,
	"users" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attribution_conversions" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"source" text NOT NULL,
	"kind" text DEFAULT 'purchase' NOT NULL,
	"transaction_id" text,
	"value" double precision,
	"currency" text,
	"email_hash" text,
	"email_mask" text,
	"visitor_id" text,
	"page_url" text,
	"items" jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"response_id" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attribution_responses" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"source_type" text NOT NULL,
	"provider" text NOT NULL,
	"form_id" text,
	"form_name" text,
	"channel" text NOT NULL,
	"channel_detail" text,
	"raw_answer" text,
	"freetext" text,
	"email_hash" text,
	"email_mask" text,
	"external_id" text,
	"respondent_name" text,
	"deal_value" double precision,
	"deal_currency" text,
	"value_source" text,
	"transaction_id" text,
	"conversion_id" text,
	"matched_via" text,
	"visitor_id" text,
	"page_url" text,
	"workflow_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"dismissed_at" timestamp with time zone,
	"dismissed_by" text,
	"dedupe_key" text,
	"responded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attribution_settings" (
	"project_id" text PRIMARY KEY NOT NULL,
	"public_key" text NOT NULL,
	"track_mode" text DEFAULT 'both' NOT NULL,
	"platform" text,
	"forms_mode" text,
	"conversion_source" text,
	"survey" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"allowed_domains" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reporting_currency" text DEFAULT 'EUR' NOT NULL,
	"wizard_step" integer DEFAULT 1 NOT NULL,
	"setup_completed_at" timestamp with time zone,
	"webhook_token_hash" text,
	"webhook_token_prefix" text,
	"webhook_token_created_at" timestamp with time zone,
	"snippet_first_seen_at" timestamp with time zone,
	"snippet_last_seen_at" timestamp with time zone,
	"snippet_last_origin" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attribution_webhook_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"status" text NOT NULL,
	"provider" text,
	"workflow_id" text,
	"response_id" text,
	"conversion_id" text,
	"message" text,
	"payload_bytes" integer DEFAULT 0 NOT NULL,
	"payload_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pending_payload" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attribution_workflows" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"provider" text DEFAULT 'custom' NOT NULL,
	"fingerprint" text NOT NULL,
	"kind" text DEFAULT 'auto' NOT NULL,
	"status" text DEFAULT 'needs_mapping' NOT NULL,
	"mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sample_payload" jsonb,
	"sample_received_at" timestamp with time zone,
	"last_payload_at" timestamp with time zone,
	"processed_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text,
	"kind" text DEFAULT 'image' NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"width" integer,
	"height" integer,
	"storage_path" text NOT NULL,
	"sha256" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_brand_kits" (
	"workspace_id" text NOT NULL,
	"scope" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_brand_kits_workspace_id_scope_pk" PRIMARY KEY("workspace_id","scope")
);
--> statement-breakpoint
CREATE TABLE "report_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"kind" text DEFAULT 'deck' NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"document" jsonb,
	"instructions" text,
	"slide_count" integer DEFAULT 0 NOT NULL,
	"source_report_id" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"kind" text DEFAULT 'deck' NOT NULL,
	"title" text NOT NULL,
	"subtitle" text,
	"template_key" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"document" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"date_range" jsonb DEFAULT '{"preset":"30d"}'::jsonb NOT NULL,
	"slide_count" integer DEFAULT 0 NOT NULL,
	"chart_count" integer DEFAULT 0 NOT NULL,
	"brand_colors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"html" text,
	"summary" text,
	"prompt" text,
	"ai_status" text DEFAULT 'idle' NOT NULL,
	"ai_error" text,
	"ai_job_id" text,
	"created_by_label" text,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"share_token" text,
	"share_enabled" boolean DEFAULT false NOT NULL,
	"share_password_hash" text,
	"share_expires_at" timestamp with time zone,
	"share_mode" text DEFAULT 'live' NOT NULL,
	"snapshot" jsonb,
	"snapshot_at" timestamp with time zone,
	"share_views" integer DEFAULT 0 NOT NULL,
	"shared_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_personas" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"topic" text NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"expertise" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"voice" text DEFAULT '' NOT NULL,
	"credentials" text,
	"source" text DEFAULT 'library' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_pieces" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"kind" text DEFAULT 'article' NOT NULL,
	"title" text NOT NULL,
	"slug" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"target_prompt" text,
	"target_keyword" text,
	"topic" text,
	"language" text DEFAULT 'en' NOT NULL,
	"source_url" text,
	"source_snapshot" jsonb,
	"persona_id" text,
	"task_id" text,
	"brief" jsonb,
	"body" text DEFAULT '' NOT NULL,
	"meta_title" text,
	"meta_description" text,
	"schema_json_ld" text,
	"faqs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"entities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"aeo_score" integer,
	"pillar_scores" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"baseline_score" integer,
	"word_count" integer DEFAULT 0 NOT NULL,
	"published_url" text,
	"published_at" timestamp with time zone,
	"publish_provider" text,
	"external_id" text,
	"generation_stage" text,
	"error" text,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_score_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"content_id" text NOT NULL,
	"project_id" text NOT NULL,
	"score" integer NOT NULL,
	"pillars" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fc_answer_checks" (
	"asset_id" text NOT NULL,
	"answer_id" text NOT NULL,
	"project_id" text NOT NULL,
	"statements" integer DEFAULT 0 NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fc_answer_checks_asset_id_answer_id_pk" PRIMARY KEY("asset_id","answer_id")
);
--> statement-breakpoint
CREATE TABLE "fc_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"markets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active_ingredient" text,
	"description" text,
	"source_url" text,
	"status" text DEFAULT 'active' NOT NULL,
	"last_checked_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fc_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"asset_id" text NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"source_url" text,
	"file_name" text,
	"market" text,
	"version" text,
	"effective_date" date,
	"superseded" boolean DEFAULT false NOT NULL,
	"file_path" text,
	"text" text DEFAULT '' NOT NULL,
	"sections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"char_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL,
	"error" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fc_statements" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"asset_id" text NOT NULL,
	"hash" text NOT NULL,
	"claim" text NOT NULL,
	"engine" text NOT NULL,
	"market" text NOT NULL,
	"prompt_id" text,
	"answer_id" text,
	"answer_quote" text,
	"verdict" text DEFAULT 'pending' NOT NULL,
	"severity" text,
	"label_section" text,
	"label_quote" text,
	"document_id" text,
	"explanation" text,
	"match_score" double precision,
	"judged_by" text,
	"status" text DEFAULT 'open' NOT NULL,
	"seen_count" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checked_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "optimize_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"kind" text NOT NULL,
	"trigger" text DEFAULT 'manual' NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "optimize_settings" (
	"project_id" text PRIMARY KEY NOT NULL,
	"routing" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"auto_resolve" boolean DEFAULT true NOT NULL,
	"webhook_events" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "optimize_task_activity" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text,
	"kind" text NOT NULL,
	"body" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "optimize_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"signal" text NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"acceptance_criteria" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"content_plan" jsonb,
	"target_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"target_prompts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"signal_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"signal_hash" text,
	"written_hash" text,
	"written_by" text DEFAULT 'template' NOT NULL,
	"impact" integer DEFAULT 5 NOT NULL,
	"effort" integer DEFAULT 5 NOT NULL,
	"priority" double precision DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolution" text,
	"auto_resolvable" boolean DEFAULT true NOT NULL,
	"signal_active" boolean DEFAULT true NOT NULL,
	"assignee_id" text,
	"due_date" date,
	"external" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source" text DEFAULT 'generator' NOT NULL,
	"created_by" text,
	"first_detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"chat_id" text,
	"message_id" text,
	"name" text NOT NULL,
	"mime_type" text NOT NULL,
	"kind" text NOT NULL,
	"size" integer NOT NULL,
	"storage_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"chat_id" text NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"rating" text NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"chat_id" text NOT NULL,
	"project_id" text NOT NULL,
	"role" text NOT NULL,
	"parts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'complete' NOT NULL,
	"error" text,
	"runtime" jsonb,
	"model_selection" text,
	"usage" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chats" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"title" text DEFAULT 'New chat' NOT NULL,
	"title_source" text DEFAULT 'provisional' NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"model_selection" text DEFAULT 'auto' NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_authorization_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"code_hash" text NOT NULL,
	"grant_id" text NOT NULL,
	"client_id" text NOT NULL,
	"user_id" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"redirect_uri_explicit" text DEFAULT 'yes' NOT NULL,
	"code_challenge" text NOT NULL,
	"code_challenge_method" text DEFAULT 'S256' NOT NULL,
	"scopes" jsonb NOT NULL,
	"resource" text,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_clients" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"redirect_uris" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"grant_types" jsonb DEFAULT '["authorization_code","refresh_token"]'::jsonb NOT NULL,
	"response_types" jsonb DEFAULT '["code"]'::jsonb NOT NULL,
	"token_endpoint_auth_method" text DEFAULT 'none' NOT NULL,
	"client_secret_hash" text,
	"scope" text,
	"client_uri" text,
	"logo_uri" text,
	"software_id" text,
	"software_version" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"registration_ip" text,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"scopes" jsonb DEFAULT '["read"]'::jsonb NOT NULL,
	"project_ids" jsonb,
	"resource" text,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_refresh_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"grant_id" text NOT NULL,
	"client_id" text NOT NULL,
	"user_id" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"rotated_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "free_tool_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"tool" text NOT NULL,
	"ok" boolean NOT NULL,
	"data" jsonb,
	"error" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "free_tool_counters" (
	"day" text NOT NULL,
	"key" text NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	"micro_usd" bigint DEFAULT 0 NOT NULL,
	"runs" integer DEFAULT 0 NOT NULL,
	"cache_hits" integer DEFAULT 0 NOT NULL,
	"blocked" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "free_tool_counters_day_key_pk" PRIMARY KEY("day","key")
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_connected_by_users_id_fk" FOREIGN KEY ("connected_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "login_tokens" ADD CONSTRAINT "login_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_shares" ADD CONSTRAINT "project_shares_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_shares" ADD CONSTRAINT "project_shares_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_chat_events" ADD CONSTRAINT "agent_chat_events_job_id_agent_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."agent_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_checkins" ADD CONSTRAINT "agent_checkins_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_job_logs" ADD CONSTRAINT "agent_job_logs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD CONSTRAINT "agent_jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD CONSTRAINT "agent_jobs_pinned_agent_id_agents_id_fk" FOREIGN KEY ("pinned_agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD CONSTRAINT "agent_jobs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_ad_appearances" ADD CONSTRAINT "ai_ad_appearances_ad_id_ai_ads_id_fk" FOREIGN KEY ("ad_id") REFERENCES "public"."ai_ads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_ad_appearances" ADD CONSTRAINT "ai_ad_appearances_answer_id_ai_answers_id_fk" FOREIGN KEY ("answer_id") REFERENCES "public"."ai_answers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_ads" ADD CONSTRAINT "ai_ads_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_ads" ADD CONSTRAINT "ai_ads_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_answers" ADD CONSTRAINT "ai_answers_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_answers" ADD CONSTRAINT "ai_answers_prompt_id_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."prompts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_answers" ADD CONSTRAINT "ai_answers_run_id_ai_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ai_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_citations" ADD CONSTRAINT "ai_citations_answer_id_ai_answers_id_fk" FOREIGN KEY ("answer_id") REFERENCES "public"."ai_answers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_citations" ADD CONSTRAINT "ai_citations_source_id_ai_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."ai_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_fanouts" ADD CONSTRAINT "ai_fanouts_answer_id_ai_answers_id_fk" FOREIGN KEY ("answer_id") REFERENCES "public"."ai_answers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_lookups" ADD CONSTRAINT "ai_lookups_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_lookups" ADD CONSTRAINT "ai_lookups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_mentions" ADD CONSTRAINT "ai_mentions_answer_id_ai_answers_id_fk" FOREIGN KEY ("answer_id") REFERENCES "public"."ai_answers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_mentions" ADD CONSTRAINT "ai_mentions_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_product_appearances" ADD CONSTRAINT "ai_product_appearances_product_id_ai_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."ai_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_product_appearances" ADD CONSTRAINT "ai_product_appearances_answer_id_ai_answers_id_fk" FOREIGN KEY ("answer_id") REFERENCES "public"."ai_answers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_products" ADD CONSTRAINT "ai_products_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_products" ADD CONSTRAINT "ai_products_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_recommendations" ADD CONSTRAINT "ai_recommendations_answer_id_ai_answers_id_fk" FOREIGN KEY ("answer_id") REFERENCES "public"."ai_answers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_recommendations" ADD CONSTRAINT "ai_recommendations_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_sources" ADD CONSTRAINT "ai_sources_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_sources" ADD CONSTRAINT "ai_sources_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_statements" ADD CONSTRAINT "ai_statements_answer_id_ai_answers_id_fk" FOREIGN KEY ("answer_id") REFERENCES "public"."ai_answers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_statements" ADD CONSTRAINT "ai_statements_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_knowledge" ADD CONSTRAINT "brand_knowledge_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_knowledge" ADD CONSTRAINT "brand_knowledge_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_products" ADD CONSTRAINT "catalog_products_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_context_notes" ADD CONSTRAINT "project_context_notes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_context_notes" ADD CONSTRAINT "project_context_notes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_research_items" ADD CONSTRAINT "prompt_research_items_list_id_prompt_research_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."prompt_research_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_research_lists" ADD CONSTRAINT "prompt_research_lists_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_research_lists" ADD CONSTRAINT "prompt_research_lists_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_tag_links" ADD CONSTRAINT "prompt_tag_links_prompt_id_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."prompts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_tag_links" ADD CONSTRAINT "prompt_tag_links_tag_id_prompt_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."prompt_tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_tags" ADD CONSTRAINT "prompt_tags_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompts" ADD CONSTRAINT "prompts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompts" ADD CONSTRAINT "prompts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_cache" ADD CONSTRAINT "seo_cache_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_keyword_metrics" ADD CONSTRAINT "seo_keyword_metrics_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_local_runs" ADD CONSTRAINT "seo_local_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_local_runs" ADD CONSTRAINT "seo_local_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_rank_configs" ADD CONSTRAINT "seo_rank_configs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_rank_configs" ADD CONSTRAINT "seo_rank_configs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_rank_keywords" ADD CONSTRAINT "seo_rank_keywords_config_id_seo_rank_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."seo_rank_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_rank_runs" ADD CONSTRAINT "seo_rank_runs_config_id_seo_rank_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."seo_rank_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_rank_runs" ADD CONSTRAINT "seo_rank_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_rank_snapshots" ADD CONSTRAINT "seo_rank_snapshots_run_id_seo_rank_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."seo_rank_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_rank_tasks" ADD CONSTRAINT "seo_rank_tasks_run_id_seo_rank_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."seo_rank_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_kw_tag_links" ADD CONSTRAINT "seo_kw_tag_links_saved_keyword_id_seo_saved_keywords_id_fk" FOREIGN KEY ("saved_keyword_id") REFERENCES "public"."seo_saved_keywords"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_kw_tag_links" ADD CONSTRAINT "seo_kw_tag_links_tag_id_seo_saved_keyword_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."seo_saved_keyword_tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_saved_keyword_tags" ADD CONSTRAINT "seo_saved_keyword_tags_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_saved_keywords" ADD CONSTRAINT "seo_saved_keywords_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_search_history" ADD CONSTRAINT "seo_search_history_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_search_history" ADD CONSTRAINT "seo_search_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_schedules" ADD CONSTRAINT "audit_schedules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_schedules" ADD CONSTRAINT "audit_schedules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawlability_checks" ADD CONSTRAINT "crawlability_checks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawlability_checks" ADD CONSTRAINT "crawlability_checks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_audit_frontier" ADD CONSTRAINT "site_audit_frontier_audit_id_site_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."site_audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_audit_issues" ADD CONSTRAINT "site_audit_issues_audit_id_site_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."site_audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_audit_lighthouse" ADD CONSTRAINT "site_audit_lighthouse_audit_id_site_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."site_audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_audit_page_links" ADD CONSTRAINT "site_audit_page_links_page_id_site_audit_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."site_audit_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_audit_page_links" ADD CONSTRAINT "site_audit_page_links_audit_id_site_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."site_audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_audit_pages" ADD CONSTRAINT "site_audit_pages_audit_id_site_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."site_audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_audits" ADD CONSTRAINT "site_audits_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_audits" ADD CONSTRAINT "site_audits_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_bot_visits" ADD CONSTRAINT "analytics_bot_visits_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_google_accounts" ADD CONSTRAINT "analytics_google_accounts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_google_accounts" ADD CONSTRAINT "analytics_google_accounts_connected_by_users_id_fk" FOREIGN KEY ("connected_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_gsc_inspections" ADD CONSTRAINT "analytics_gsc_inspections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_gsc_inspections" ADD CONSTRAINT "analytics_gsc_inspections_inspected_by_users_id_fk" FOREIGN KEY ("inspected_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_log_ingest_stats" ADD CONSTRAINT "analytics_log_ingest_stats_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_log_uploads" ADD CONSTRAINT "analytics_log_uploads_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_log_uploads" ADD CONSTRAINT "analytics_log_uploads_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_sc_daily" ADD CONSTRAINT "analytics_sc_daily_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_sc_pages" ADD CONSTRAINT "analytics_sc_pages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_sc_queries" ADD CONSTRAINT "analytics_sc_queries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_sc_query_intents" ADD CONSTRAINT "analytics_sc_query_intents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_traffic_daily" ADD CONSTRAINT "analytics_traffic_daily_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_traffic_rows" ADD CONSTRAINT "analytics_traffic_rows_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_conversions" ADD CONSTRAINT "attribution_conversions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_responses" ADD CONSTRAINT "attribution_responses_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_responses" ADD CONSTRAINT "attribution_responses_dismissed_by_users_id_fk" FOREIGN KEY ("dismissed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_settings" ADD CONSTRAINT "attribution_settings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_settings" ADD CONSTRAINT "attribution_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_webhook_logs" ADD CONSTRAINT "attribution_webhook_logs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_workflows" ADD CONSTRAINT "attribution_workflows_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_assets" ADD CONSTRAINT "report_assets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_assets" ADD CONSTRAINT "report_assets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_assets" ADD CONSTRAINT "report_assets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_brand_kits" ADD CONSTRAINT "report_brand_kits_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_brand_kits" ADD CONSTRAINT "report_brand_kits_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_templates" ADD CONSTRAINT "report_templates_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_templates" ADD CONSTRAINT "report_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_personas" ADD CONSTRAINT "content_personas_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_pieces" ADD CONSTRAINT "content_pieces_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_pieces" ADD CONSTRAINT "content_pieces_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_pieces" ADD CONSTRAINT "content_pieces_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_score_snapshots" ADD CONSTRAINT "content_score_snapshots_content_id_content_pieces_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content_pieces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fc_answer_checks" ADD CONSTRAINT "fc_answer_checks_asset_id_fc_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."fc_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fc_assets" ADD CONSTRAINT "fc_assets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fc_assets" ADD CONSTRAINT "fc_assets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fc_documents" ADD CONSTRAINT "fc_documents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fc_documents" ADD CONSTRAINT "fc_documents_asset_id_fc_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."fc_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fc_documents" ADD CONSTRAINT "fc_documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fc_statements" ADD CONSTRAINT "fc_statements_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fc_statements" ADD CONSTRAINT "fc_statements_asset_id_fc_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."fc_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fc_statements" ADD CONSTRAINT "fc_statements_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "optimize_runs" ADD CONSTRAINT "optimize_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "optimize_settings" ADD CONSTRAINT "optimize_settings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "optimize_task_activity" ADD CONSTRAINT "optimize_task_activity_task_id_optimize_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."optimize_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "optimize_task_activity" ADD CONSTRAINT "optimize_task_activity_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "optimize_tasks" ADD CONSTRAINT "optimize_tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "optimize_tasks" ADD CONSTRAINT "optimize_tasks_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "optimize_tasks" ADD CONSTRAINT "optimize_tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_attachments" ADD CONSTRAINT "chat_attachments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_attachments" ADD CONSTRAINT "chat_attachments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_attachments" ADD CONSTRAINT "chat_attachments_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_attachments" ADD CONSTRAINT "chat_attachments_message_id_chat_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."chat_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_feedback" ADD CONSTRAINT "chat_feedback_message_id_chat_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."chat_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_feedback" ADD CONSTRAINT "chat_feedback_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_feedback" ADD CONSTRAINT "chat_feedback_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_feedback" ADD CONSTRAINT "chat_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_authorization_codes" ADD CONSTRAINT "oauth_authorization_codes_grant_id_oauth_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."oauth_grants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_client_id_oauth_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_refresh_tokens" ADD CONSTRAINT "oauth_refresh_tokens_grant_id_oauth_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."oauth_grants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_hash_uq" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "api_request_logs_created_idx" ON "api_request_logs" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_project_provider_uq" ON "integrations" USING btree ("project_id","provider");--> statement-breakpoint
CREATE INDEX "integrations_token_idx" ON "integrations" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_uq" ON "invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "invitations_email_idx" ON "invitations" USING btree ("email");--> statement-breakpoint
CREATE INDEX "jobs_pick_idx" ON "jobs" USING btree ("status","run_at","priority");--> statement-breakpoint
CREATE INDEX "jobs_project_idx" ON "jobs" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_dedupe_uq" ON "jobs" USING btree ("dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "login_tokens_hash_uq" ON "login_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "login_tokens_email_idx" ON "login_tokens" USING btree ("email");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "projects_workspace_idx" ON "projects" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_uq" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "usage_events_created_idx" ON "usage_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "usage_events_project_idx" ON "usage_events" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "agent_chat_events_job_idx" ON "agent_chat_events" USING btree ("job_id","seq");--> statement-breakpoint
CREATE INDEX "agent_checkins_agent_idx" ON "agent_checkins" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_events_agent_idx" ON "agent_events" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_events_job_idx" ON "agent_events" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "agent_job_logs_agent_idx" ON "agent_job_logs" USING btree ("agent_id","seq");--> statement-breakpoint
CREATE INDEX "agent_job_logs_job_idx" ON "agent_job_logs" USING btree ("job_id","seq");--> statement-breakpoint
CREATE INDEX "agent_jobs_pick_idx" ON "agent_jobs" USING btree ("status","queued_at");--> statement-breakpoint
CREATE INDEX "agent_jobs_agent_idx" ON "agent_jobs" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_jobs_pinned_idx" ON "agent_jobs" USING btree ("pinned_agent_id");--> statement-breakpoint
CREATE INDEX "agent_jobs_workspace_idx" ON "agent_jobs" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agents_token_uq" ON "agents" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "agents_workspace_idx" ON "agents" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "agents_seen_idx" ON "agents" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "ai_ad_appearances_project_idx" ON "ai_ad_appearances" USING btree ("project_id","answer_date");--> statement-breakpoint
CREATE INDEX "ai_ad_appearances_answer_idx" ON "ai_ad_appearances" USING btree ("answer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_ads_project_fp_uq" ON "ai_ads" USING btree ("project_id","fingerprint");--> statement-breakpoint
CREATE INDEX "ai_answers_project_date_idx" ON "ai_answers" USING btree ("project_id","answer_date");--> statement-breakpoint
CREATE INDEX "ai_answers_prompt_idx" ON "ai_answers" USING btree ("prompt_id","answer_date");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_answers_unique_day_uq" ON "ai_answers" USING btree ("prompt_id","engine","answer_date");--> statement-breakpoint
CREATE INDEX "ai_citations_project_date_idx" ON "ai_citations" USING btree ("project_id","answer_date");--> statement-breakpoint
CREATE INDEX "ai_citations_source_idx" ON "ai_citations" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "ai_citations_answer_idx" ON "ai_citations" USING btree ("answer_id");--> statement-breakpoint
CREATE INDEX "ai_fanouts_project_idx" ON "ai_fanouts" USING btree ("project_id","answer_date");--> statement-breakpoint
CREATE INDEX "ai_fanouts_answer_idx" ON "ai_fanouts" USING btree ("answer_id");--> statement-breakpoint
CREATE INDEX "ai_lookups_project_idx" ON "ai_lookups" USING btree ("project_id","kind","created_at");--> statement-breakpoint
CREATE INDEX "ai_mentions_project_date_idx" ON "ai_mentions" USING btree ("project_id","answer_date");--> statement-breakpoint
CREATE INDEX "ai_mentions_answer_idx" ON "ai_mentions" USING btree ("answer_id");--> statement-breakpoint
CREATE INDEX "ai_mentions_competitor_idx" ON "ai_mentions" USING btree ("competitor_id","answer_date");--> statement-breakpoint
CREATE INDEX "ai_product_appearances_project_idx" ON "ai_product_appearances" USING btree ("project_id","answer_date");--> statement-breakpoint
CREATE INDEX "ai_product_appearances_product_idx" ON "ai_product_appearances" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "ai_product_appearances_answer_idx" ON "ai_product_appearances" USING btree ("answer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_products_project_name_uq" ON "ai_products" USING btree ("project_id","normalized_name");--> statement-breakpoint
CREATE INDEX "ai_recommendations_project_idx" ON "ai_recommendations" USING btree ("project_id","answer_date","kind");--> statement-breakpoint
CREATE INDEX "ai_recommendations_answer_idx" ON "ai_recommendations" USING btree ("answer_id");--> statement-breakpoint
CREATE INDEX "ai_runs_project_idx" ON "ai_runs" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_sources_project_url_uq" ON "ai_sources" USING btree ("project_id","url");--> statement-breakpoint
CREATE INDEX "ai_sources_domain_idx" ON "ai_sources" USING btree ("project_id","domain");--> statement-breakpoint
CREATE INDEX "ai_statements_project_idx" ON "ai_statements" USING btree ("project_id","answer_date","polarity");--> statement-breakpoint
CREATE INDEX "ai_statements_answer_idx" ON "ai_statements" USING btree ("answer_id");--> statement-breakpoint
CREATE INDEX "catalog_products_project_idx" ON "catalog_products" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_products_project_key_uq" ON "catalog_products" USING btree ("project_id","product_key");--> statement-breakpoint
CREATE INDEX "competitors_project_idx" ON "competitors" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "competitors_project_name_uq" ON "competitors" USING btree ("project_id","name");--> statement-breakpoint
CREATE INDEX "project_context_notes_project_idx" ON "project_context_notes" USING btree ("project_id","category");--> statement-breakpoint
CREATE INDEX "prompt_research_items_list_idx" ON "prompt_research_items" USING btree ("list_id");--> statement-breakpoint
CREATE INDEX "prompt_research_items_project_idx" ON "prompt_research_items" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "prompt_research_lists_project_idx" ON "prompt_research_lists" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "prompt_tag_links_tag_idx" ON "prompt_tag_links" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_tags_project_name_uq" ON "prompt_tags" USING btree ("project_id","name");--> statement-breakpoint
CREATE INDEX "prompts_project_idx" ON "prompts" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "seo_cache_expires_idx" ON "seo_cache" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "seo_cache_project_idx" ON "seo_cache" USING btree ("project_id","namespace");--> statement-breakpoint
CREATE UNIQUE INDEX "seo_keyword_metrics_uq" ON "seo_keyword_metrics" USING btree ("project_id","keyword","location_code","language_code");--> statement-breakpoint
CREATE INDEX "seo_keyword_metrics_fetched_idx" ON "seo_keyword_metrics" USING btree ("project_id","fetched_at");--> statement-breakpoint
CREATE INDEX "seo_local_runs_project_idx" ON "seo_local_runs" USING btree ("project_id","tool","created_at");--> statement-breakpoint
CREATE INDEX "seo_rank_configs_project_idx" ON "seo_rank_configs" USING btree ("project_id","is_active","created_at");--> statement-breakpoint
CREATE INDEX "seo_rank_configs_due_idx" ON "seo_rank_configs" USING btree ("is_active","next_check_at");--> statement-breakpoint
CREATE UNIQUE INDEX "seo_rank_configs_national_uq" ON "seo_rank_configs" USING btree ("project_id","domain","location_code") WHERE location_name IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "seo_rank_configs_local_uq" ON "seo_rank_configs" USING btree ("project_id","domain","location_code","location_name") WHERE location_name IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "seo_rank_keywords_uq" ON "seo_rank_keywords" USING btree ("config_id","keyword");--> statement-breakpoint
CREATE INDEX "seo_rank_runs_config_idx" ON "seo_rank_runs" USING btree ("config_id","started_at");--> statement-breakpoint
CREATE INDEX "seo_rank_runs_project_idx" ON "seo_rank_runs" USING btree ("project_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "seo_rank_runs_one_active_uq" ON "seo_rank_runs" USING btree ("config_id") WHERE status IN ('pending', 'running');--> statement-breakpoint
CREATE INDEX "seo_rank_snapshots_kw_idx" ON "seo_rank_snapshots" USING btree ("tracking_keyword_id","device","checked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "seo_rank_snapshots_uq" ON "seo_rank_snapshots" USING btree ("run_id","tracking_keyword_id","device");--> statement-breakpoint
CREATE INDEX "seo_rank_tasks_run_idx" ON "seo_rank_tasks" USING btree ("run_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "seo_rank_tasks_uq" ON "seo_rank_tasks" USING btree ("run_id","tracking_keyword_id","device");--> statement-breakpoint
CREATE INDEX "seo_kw_tag_links_tag_idx" ON "seo_kw_tag_links" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "seo_saved_keyword_tags_uq" ON "seo_saved_keyword_tags" USING btree ("project_id","normalized_name");--> statement-breakpoint
CREATE INDEX "seo_saved_keyword_tags_name_idx" ON "seo_saved_keyword_tags" USING btree ("project_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "seo_saved_keywords_uq" ON "seo_saved_keywords" USING btree ("project_id","keyword","location_code","language_code");--> statement-breakpoint
CREATE INDEX "seo_saved_keywords_project_idx" ON "seo_saved_keywords" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "seo_search_history_uq" ON "seo_search_history" USING btree ("project_id","user_id","feature","dedupe_key");--> statement-breakpoint
CREATE INDEX "seo_search_history_list_idx" ON "seo_search_history" USING btree ("project_id","user_id","feature","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_schedules_project_kind_uq" ON "audit_schedules" USING btree ("project_id","kind");--> statement-breakpoint
CREATE INDEX "audit_schedules_due_idx" ON "audit_schedules" USING btree ("enabled","next_run_at");--> statement-breakpoint
CREATE INDEX "crawlability_checks_project_idx" ON "crawlability_checks" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "site_audit_frontier_claim_idx" ON "site_audit_frontier" USING btree ("audit_id","state","source","seq");--> statement-breakpoint
CREATE INDEX "site_audit_issues_type_idx" ON "site_audit_issues" USING btree ("audit_id","issue_type");--> statement-breakpoint
CREATE INDEX "site_audit_issues_page_idx" ON "site_audit_issues" USING btree ("audit_id","page_id");--> statement-breakpoint
CREATE INDEX "site_audit_lighthouse_audit_idx" ON "site_audit_lighthouse" USING btree ("audit_id","status");--> statement-breakpoint
CREATE INDEX "site_audit_page_links_audit_idx" ON "site_audit_page_links" USING btree ("audit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "site_audit_pages_url_uq" ON "site_audit_pages" USING btree ("audit_id","url");--> statement-breakpoint
CREATE INDEX "site_audit_pages_crawled_idx" ON "site_audit_pages" USING btree ("audit_id","crawled_at");--> statement-breakpoint
CREATE INDEX "site_audits_project_idx" ON "site_audits" USING btree ("project_id","started_at");--> statement-breakpoint
CREATE INDEX "site_audits_status_idx" ON "site_audits" USING btree ("status","heartbeat_at");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_bot_visits_dedupe_uq" ON "analytics_bot_visits" USING btree ("project_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "analytics_bot_visits_ts_idx" ON "analytics_bot_visits" USING btree ("project_id","ts");--> statement-breakpoint
CREATE INDEX "analytics_bot_visits_path_idx" ON "analytics_bot_visits" USING btree ("project_id","path");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_google_accounts_ws_sub_uq" ON "analytics_google_accounts" USING btree ("workspace_id","sub");--> statement-breakpoint
CREATE INDEX "analytics_gsc_inspections_project_idx" ON "analytics_gsc_inspections" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "analytics_gsc_inspections_url_idx" ON "analytics_gsc_inspections" USING btree ("project_id","url","created_at");--> statement-breakpoint
CREATE INDEX "analytics_gsc_inspections_site_idx" ON "analytics_gsc_inspections" USING btree ("site_url","created_at");--> statement-breakpoint
CREATE INDEX "analytics_log_uploads_project_idx" ON "analytics_log_uploads" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "analytics_sc_pages_idx" ON "analytics_sc_pages" USING btree ("project_id","source","date");--> statement-breakpoint
CREATE INDEX "analytics_sc_queries_idx" ON "analytics_sc_queries" USING btree ("project_id","source","date");--> statement-breakpoint
CREATE INDEX "analytics_traffic_rows_idx" ON "analytics_traffic_rows" USING btree ("project_id","provider","date");--> statement-breakpoint
CREATE UNIQUE INDEX "attribution_conversions_tx_uq" ON "attribution_conversions" USING btree ("project_id","transaction_id");--> statement-breakpoint
CREATE INDEX "attribution_conversions_project_time_idx" ON "attribution_conversions" USING btree ("project_id","occurred_at");--> statement-breakpoint
CREATE INDEX "attribution_conversions_email_idx" ON "attribution_conversions" USING btree ("project_id","email_hash");--> statement-breakpoint
CREATE INDEX "attribution_conversions_visitor_idx" ON "attribution_conversions" USING btree ("project_id","visitor_id");--> statement-breakpoint
CREATE INDEX "attribution_responses_project_time_idx" ON "attribution_responses" USING btree ("project_id","responded_at");--> statement-breakpoint
CREATE INDEX "attribution_responses_email_idx" ON "attribution_responses" USING btree ("project_id","email_hash");--> statement-breakpoint
CREATE INDEX "attribution_responses_tx_idx" ON "attribution_responses" USING btree ("project_id","transaction_id");--> statement-breakpoint
CREATE INDEX "attribution_responses_visitor_idx" ON "attribution_responses" USING btree ("project_id","visitor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attribution_responses_dedupe_uq" ON "attribution_responses" USING btree ("project_id","dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "attribution_settings_public_key_uq" ON "attribution_settings" USING btree ("public_key");--> statement-breakpoint
CREATE INDEX "attribution_webhook_logs_project_idx" ON "attribution_webhook_logs" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "attribution_webhook_logs_workflow_idx" ON "attribution_webhook_logs" USING btree ("workflow_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attribution_workflows_fingerprint_uq" ON "attribution_workflows" USING btree ("project_id","fingerprint");--> statement-breakpoint
CREATE INDEX "report_assets_workspace_idx" ON "report_assets" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "report_templates_workspace_idx" ON "report_templates" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE INDEX "reports_project_idx" ON "reports" USING btree ("project_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reports_share_token_uq" ON "reports" USING btree ("share_token");--> statement-breakpoint
CREATE INDEX "content_personas_project_topic_idx" ON "content_personas" USING btree ("project_id","topic");--> statement-breakpoint
CREATE INDEX "content_pieces_project_idx" ON "content_pieces" USING btree ("project_id","updated_at");--> statement-breakpoint
CREATE INDEX "content_score_snapshots_content_idx" ON "content_score_snapshots" USING btree ("content_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "fc_assets_project_name_uq" ON "fc_assets" USING btree ("project_id","name");--> statement-breakpoint
CREATE INDEX "fc_documents_asset_idx" ON "fc_documents" USING btree ("asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fc_statements_hash_uq" ON "fc_statements" USING btree ("project_id","hash");--> statement-breakpoint
CREATE INDEX "fc_statements_asset_idx" ON "fc_statements" USING btree ("asset_id","verdict");--> statement-breakpoint
CREATE INDEX "fc_statements_project_seen_idx" ON "fc_statements" USING btree ("project_id","last_seen_at");--> statement-breakpoint
CREATE INDEX "optimize_runs_project_idx" ON "optimize_runs" USING btree ("project_id","kind","started_at");--> statement-breakpoint
CREATE INDEX "optimize_task_activity_task_idx" ON "optimize_task_activity" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "optimize_tasks_project_fp_uq" ON "optimize_tasks" USING btree ("project_id","fingerprint");--> statement-breakpoint
CREATE INDEX "optimize_tasks_project_status_idx" ON "optimize_tasks" USING btree ("project_id","status","priority");--> statement-breakpoint
CREATE INDEX "chat_attachments_chat_idx" ON "chat_attachments" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "chat_attachments_user_idx" ON "chat_attachments" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_feedback_message_user_uq" ON "chat_feedback" USING btree ("message_id","user_id");--> statement-breakpoint
CREATE INDEX "chat_feedback_project_idx" ON "chat_feedback" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "chat_messages_chat_idx" ON "chat_messages" USING btree ("chat_id","created_at");--> statement-breakpoint
CREATE INDEX "chat_messages_project_idx" ON "chat_messages" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "chats_project_user_idx" ON "chats" USING btree ("project_id","user_id","last_message_at");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_codes_hash_uq" ON "oauth_authorization_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "oauth_clients_created_idx" ON "oauth_clients" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "oauth_grants_user_idx" ON "oauth_grants" USING btree ("user_id","workspace_id");--> statement-breakpoint
CREATE INDEX "oauth_grants_client_idx" ON "oauth_grants" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_refresh_hash_uq" ON "oauth_refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "oauth_refresh_grant_idx" ON "oauth_refresh_tokens" USING btree ("grant_id");--> statement-breakpoint
CREATE INDEX "free_tool_cache_expires_idx" ON "free_tool_cache" USING btree ("expires_at");