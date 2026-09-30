-- Private research has no foreign key or projection into public_items/publication.
CREATE TABLE research_targets (
 id text PRIMARY KEY, version integer NOT NULL DEFAULT 1, question text NOT NULL,
 domain text NOT NULL, hypothesis text, public_terms text[] NOT NULL DEFAULT '{}', terms text[] NOT NULL DEFAULT '{}',
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE research_evidence (
 id text PRIMARY KEY, identity text NOT NULL, content_hash text NOT NULL,
 previous_id text REFERENCES research_evidence(id), article_id text, article_revision integer,
 title text NOT NULL, url text NOT NULL, source text NOT NULL, origin_key text NOT NULL,
 body text NOT NULL, claims jsonb NOT NULL DEFAULT '[]', domain text NOT NULL DEFAULT 'unknown',
 published_at timestamptz, occurred_at timestamptz, time_precision text NOT NULL DEFAULT 'unknown',
 available_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz NOT NULL DEFAULT now(),
 mode text NOT NULL CHECK(mode IN ('demo','source')), fetch_status text NOT NULL DEFAULT 'ok',
 UNIQUE(identity, content_hash)
);
CREATE INDEX research_evidence_available ON research_evidence(available_at DESC);
CREATE TABLE research_runs (
 id text PRIMARY KEY, target_id text NOT NULL REFERENCES research_targets(id), target_version integer NOT NULL,
 input_key text NOT NULL, snapshot jsonb NOT NULL, status text NOT NULL DEFAULT 'queued'
 CHECK(status IN ('queued','running','completed','failed','not_configured','budget_exhausted','cancelled','unknown')),
 trigger text NOT NULL, steps jsonb NOT NULL DEFAULT '[]', calls integer NOT NULL DEFAULT 0,
 max_calls integer NOT NULL DEFAULT 5, receipt_id bigint REFERENCES receipts(id),
 stop_reason text, created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
 UNIQUE(target_id,target_version,input_key)
);
CREATE TABLE research_briefs (
 id text PRIMARY KEY, run_id text NOT NULL UNIQUE REFERENCES research_runs(id),
 target_id text NOT NULL REFERENCES research_targets(id), target_version integer NOT NULL,
 input_ids text[] NOT NULL, output jsonb NOT NULL, mode text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE research_actions (
 id bigserial PRIMARY KEY, target_id text NOT NULL REFERENCES research_targets(id),
 brief_id text REFERENCES research_briefs(id), action text NOT NULL CHECK(action IN ('confirm','correct','ignore','result')),
 note text, created_at timestamptz NOT NULL DEFAULT now()
);
-- Conservative additional service defaults. Live adapters stay disabled until explicitly configured.
INSERT INTO budgets(service,per_minute,per_hour,per_day) VALUES ('research-fetch',3,12,30),('research-search',2,6,12) ON CONFLICT DO NOTHING;
