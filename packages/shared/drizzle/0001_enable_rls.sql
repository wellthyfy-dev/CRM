-- Supabase exposes the public schema through PostgREST to anyone holding the anon key (which ships to the
-- browser). Enable row-level security with NO policies so anon/authenticated roles can read nothing directly.
-- The api/worker connect as the table owner via DATABASE_URL and are unaffected.
ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organisations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "suppressions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "research" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "programmes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "template_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "emails" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "replies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "proposals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "activities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_usage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "discovery_runs" ENABLE ROW LEVEL SECURITY;
