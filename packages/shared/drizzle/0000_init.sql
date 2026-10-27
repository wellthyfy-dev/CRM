CREATE TYPE "public"."email_check_status" AS ENUM('unknown', 'valid', 'invalid', 'catch_all', 'risky');--> statement-breakpoint
CREATE TYPE "public"."email_kind" AS ENUM('first_contact', 'follow_up_1', 'follow_up_2', 'proposal');--> statement-breakpoint
CREATE TYPE "public"."email_status" AS ENUM('draft', 'pending_approval', 'approved', 'queued', 'sent', 'failed', 'replied', 'bounced', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."org_source" AS ENUM('manual', 'import', 'discovery');--> statement-breakpoint
CREATE TYPE "public"."org_type" AS ENUM('college_university', 'company');--> statement-breakpoint
CREATE TYPE "public"."programme_audience" AS ENUM('college', 'company', 'both');--> statement-breakpoint
CREATE TYPE "public"."proposal_status" AS ENUM('draft', 'sent', 'accepted', 'declined');--> statement-breakpoint
CREATE TYPE "public"."reply_classification" AS ENUM('interested', 'not_interested', 'unsubscribe', 'out_of_office', 'bounce', 'other');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('admin', 'researcher', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."segment" AS ENUM('arts_science', 'engineering', 'mba_commerce', 'other_college', 'fmcg', 'otc', 'pharma', 'startup_b2b', 'other_company');--> statement-breakpoint
CREATE TYPE "public"."stage" AS ENUM('research_needed', 'verified', 'approved', 'drafted', 'sent', 'replied', 'meeting_scheduled', 'proposal_sent', 'training_confirmed', 'lost', 'on_hold');--> statement-breakpoint
CREATE TYPE "public"."template_kind" AS ENUM('first_contact', 'follow_up_1', 'follow_up_2');--> statement-breakpoint
CREATE SEQUENCE "public"."organisation_record_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid,
	"user_id" uuid,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purpose" text NOT NULL,
	"model" text NOT NULL,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"cost_inr" numeric(12, 4) DEFAULT 0 NOT NULL,
	"organisation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"full_name" text DEFAULT '' NOT NULL,
	"designation" text,
	"email" text,
	"phone" text,
	"source_url" text,
	"verified" boolean DEFAULT false NOT NULL,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"opt_out" boolean DEFAULT false NOT NULL,
	"opt_out_at" timestamp with time zone,
	"email_check_status" "email_check_status" DEFAULT 'unknown' NOT NULL,
	"email_checked_at" timestamp with time zone,
	"is_primary" boolean DEFAULT false NOT NULL,
	"ai_suggested" boolean DEFAULT false NOT NULL,
	"anonymised_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discovery_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"query" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"results_count" integer DEFAULT 0 NOT NULL,
	"searches_used" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"contact_id" uuid,
	"template_id" uuid,
	"template_version" integer,
	"kind" "email_kind" DEFAULT 'first_contact' NOT NULL,
	"follow_up_no" integer DEFAULT 0 NOT NULL,
	"parent_email_id" uuid,
	"thread_id" uuid,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"status" "email_status" DEFAULT 'draft' NOT NULL,
	"created_by" uuid,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"rejection_reason" text,
	"gate_failure_reason" text,
	"imap_draft_uid" integer,
	"message_id" text,
	"in_reply_to" text,
	"references" text,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scheduled_for" timestamp with time zone,
	"queued_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"send_attempts" integer DEFAULT 0 NOT NULL,
	"follow_up_offset_days" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organisations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"record_id" text DEFAULT 'WF-' || lpad(nextval('organisation_record_seq')::text, 6, '0') NOT NULL,
	"name" text NOT NULL,
	"org_type" "org_type" NOT NULL,
	"segment" "segment" NOT NULL,
	"industry_department" text,
	"city" text,
	"district" text,
	"state" text,
	"website" text,
	"domain" text,
	"stage" "stage" DEFAULT 'research_needed' NOT NULL,
	"owner_id" uuid,
	"do_not_contact" boolean DEFAULT false NOT NULL,
	"lost_reason" text,
	"next_follow_up_at" timestamp with time zone,
	"notes" text,
	"source" "org_source" DEFAULT 'manual' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text,
	"full_name" text DEFAULT '' NOT NULL,
	"role" "role" DEFAULT 'viewer' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "programmes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"audience" "programme_audience" DEFAULT 'both' NOT NULL,
	"segments" "segment"[] DEFAULT '{}' NOT NULL,
	"modules" text[] DEFAULT '{}' NOT NULL,
	"duration_options" text[] DEFAULT '{}' NOT NULL,
	"indicative_fee_min" numeric(12, 2),
	"indicative_fee_max" numeric(12, 2),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"programme_id" uuid,
	"contact_id" uuid,
	"email_id" uuid,
	"duration" text,
	"value_inr" numeric(12, 2),
	"notes" text,
	"status" "proposal_status" DEFAULT 'draft' NOT NULL,
	"file_path" text,
	"sent_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email_id" uuid,
	"organisation_id" uuid,
	"contact_id" uuid,
	"from_email" text NOT NULL,
	"subject" text,
	"snippet" text,
	"received_at" timestamp with time zone NOT NULL,
	"message_id" text,
	"imap_uid" integer,
	"classification" "reply_classification" DEFAULT 'other' NOT NULL,
	"summary" text,
	"handled" boolean DEFAULT false NOT NULL,
	"handled_by" uuid,
	"handled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"website_evidence" text,
	"training_need" text,
	"recommended_programme_id" uuid,
	"duration_format" text,
	"personalisation_note" text,
	"source_pages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ai_output" jsonb,
	"ai_model" text,
	"ai_generated" boolean DEFAULT false NOT NULL,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"cost_inr" numeric(12, 4) DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"daily_send_cap" integer DEFAULT 30 NOT NULL,
	"hourly_send_cap" integer DEFAULT 10 NOT NULL,
	"send_window_start" text DEFAULT '10:00' NOT NULL,
	"send_window_end" text DEFAULT '17:00' NOT NULL,
	"send_days" text[] DEFAULT '{Mon,Tue,Wed,Thu,Fri,Sat}' NOT NULL,
	"follow_up_1_days" integer DEFAULT 7 NOT NULL,
	"follow_up_2_days" integer DEFAULT 14 NOT NULL,
	"ai_model" text,
	"ai_monthly_limit_inr" numeric(12, 2) DEFAULT 2000 NOT NULL,
	"search_monthly_limit" integer DEFAULT 500 NOT NULL,
	"signature" text DEFAULT '' NOT NULL,
	"opt_out_line" text DEFAULT '' NOT NULL,
	"privacy_notice_url" text,
	"imap_last_uid" integer DEFAULT 0 NOT NULL,
	"imap_uid_validity" text,
	"queue_paused" boolean DEFAULT false NOT NULL,
	"queue_paused_until" timestamp with time zone,
	"queue_pause_reason" text,
	"next_send_after" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email_hash" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "template_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"segments" "segment"[] DEFAULT '{}' NOT NULL,
	"kind" "template_kind" DEFAULT 'first_contact' NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_verified_by_profiles_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_runs" ADD CONSTRAINT "discovery_runs_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_parent_email_id_emails_id_fk" FOREIGN KEY ("parent_email_id") REFERENCES "public"."emails"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_submitted_by_profiles_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_approved_by_profiles_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisations" ADD CONSTRAINT "organisations_owner_id_profiles_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisations" ADD CONSTRAINT "organisations_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_programme_id_programmes_id_fk" FOREIGN KEY ("programme_id") REFERENCES "public"."programmes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_email_id_emails_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."emails"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replies" ADD CONSTRAINT "replies_email_id_emails_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."emails"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replies" ADD CONSTRAINT "replies_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replies" ADD CONSTRAINT "replies_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replies" ADD CONSTRAINT "replies_handled_by_profiles_id_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research" ADD CONSTRAINT "research_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research" ADD CONSTRAINT "research_recommended_programme_id_programmes_id_fk" FOREIGN KEY ("recommended_programme_id") REFERENCES "public"."programmes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research" ADD CONSTRAINT "research_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activities_organisation_idx" ON "activities" USING btree ("organisation_id","created_at");--> statement-breakpoint
CREATE INDEX "activities_type_idx" ON "activities" USING btree ("type","created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_created_idx" ON "ai_usage" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_email_key" ON "contacts" USING btree ("email");--> statement-breakpoint
CREATE INDEX "contacts_organisation_idx" ON "contacts" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "discovery_runs_created_idx" ON "discovery_runs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "emails_message_id_key" ON "emails" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "emails_organisation_idx" ON "emails" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "emails_contact_sent_idx" ON "emails" USING btree ("contact_id","sent_at");--> statement-breakpoint
CREATE INDEX "emails_status_idx" ON "emails" USING btree ("status");--> statement-breakpoint
CREATE INDEX "emails_sent_at_idx" ON "emails" USING btree ("sent_at");--> statement-breakpoint
CREATE INDEX "emails_thread_idx" ON "emails" USING btree ("thread_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organisations_record_id_key" ON "organisations" USING btree ("record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organisations_domain_key" ON "organisations" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "organisations_stage_idx" ON "organisations" USING btree ("stage");--> statement-breakpoint
CREATE INDEX "organisations_segment_idx" ON "organisations" USING btree ("segment");--> statement-breakpoint
CREATE INDEX "organisations_owner_idx" ON "organisations" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "organisations_next_follow_up_idx" ON "organisations" USING btree ("next_follow_up_at");--> statement-breakpoint
CREATE INDEX "organisations_city_idx" ON "organisations" USING btree ("city");--> statement-breakpoint
CREATE INDEX "organisations_state_idx" ON "organisations" USING btree ("state");--> statement-breakpoint
CREATE INDEX "organisations_name_lower_idx" ON "organisations" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "proposals_organisation_idx" ON "proposals" USING btree ("organisation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "replies_message_id_key" ON "replies" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "replies_organisation_idx" ON "replies" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "replies_received_idx" ON "replies" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "research_organisation_idx" ON "research" USING btree ("organisation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "suppressions_email_hash_key" ON "suppressions" USING btree ("email_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "template_versions_template_version_key" ON "template_versions" USING btree ("template_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "templates_key_key" ON "templates" USING btree ("key");