/**
 * Database schema as ordered migrations. Never edit a migration that has
 * shipped; append a new one. `PRAGMA user_version` records how many have run.
 */
export const MIGRATIONS: string[] = [
  // 1 — initial schema
  `
  -- Job index ---------------------------------------------------------------
  CREATE TABLE jobs (
    rid               INTEGER PRIMARY KEY AUTOINCREMENT,  -- rowid shared with jobs_fts
    id                TEXT NOT NULL UNIQUE,               -- stable hash(source, feed_key, external_id)
    source            TEXT NOT NULL,                      -- adapter id, e.g. 'greenhouse'
    feed_key          TEXT NOT NULL,                      -- sync unit, e.g. 'remotive' or 'greenhouse:stripe'
    external_id       TEXT NOT NULL,
    cluster_key       TEXT NOT NULL,                      -- same job across sources
    url               TEXT NOT NULL,
    apply_url         TEXT,
    title             TEXT NOT NULL,
    title_core        TEXT NOT NULL,                      -- normalised title without seniority/noise
    role_id           TEXT,
    family_id         TEXT,
    company           TEXT NOT NULL,
    company_key       TEXT NOT NULL,                      -- normalised company name
    company_url       TEXT,
    company_logo      TEXT,
    location_text     TEXT NOT NULL DEFAULT '',
    remote            TEXT NOT NULL DEFAULT 'unknown',    -- remote | hybrid | onsite | unknown
    remote_scope      TEXT NOT NULL DEFAULT '[]',         -- JSON array of ISO alpha-2 codes
    places            TEXT NOT NULL DEFAULT '[]',         -- JSON array of Place
    salary_min        REAL,
    salary_max        REAL,
    salary_currency   TEXT,
    salary_period     TEXT,
    salary_annual_min REAL,
    salary_annual_max REAL,
    salary_text       TEXT,
    salary_inferred   INTEGER NOT NULL DEFAULT 0,
    employment_type   TEXT NOT NULL DEFAULT 'unknown',
    seniority         TEXT NOT NULL DEFAULT 'unknown',
    department        TEXT,
    tags              TEXT NOT NULL DEFAULT '[]',         -- JSON array of strings
    skills            TEXT NOT NULL DEFAULT '[]',         -- JSON array of canonical skill names
    snippet           TEXT NOT NULL DEFAULT '',
    description_html  TEXT NOT NULL DEFAULT '',           -- sanitised HTML ('' when not fetched)
    posted_at         TEXT,                               -- ISO-8601 UTC
    first_seen_at     TEXT NOT NULL,
    last_seen_at      TEXT NOT NULL,
    closed_at         TEXT,
    liveness_status   TEXT,                               -- open | closed | unknown
    liveness_at       TEXT,
    content_hash      TEXT NOT NULL,
    UNIQUE (source, feed_key, external_id)
  );
  CREATE INDEX jobs_cluster     ON jobs (cluster_key);
  CREATE INDEX jobs_feed        ON jobs (feed_key);
  CREATE INDEX jobs_company     ON jobs (company_key);
  CREATE INDEX jobs_role        ON jobs (role_id);
  CREATE INDEX jobs_open_posted ON jobs (closed_at, posted_at);
  CREATE INDEX jobs_first_seen  ON jobs (first_seen_at);

  -- Location index rows, for fast indexed location filtering:
  --   city    one per city the job is tied to (city, admin1, country, lat, lon)
  --   admin1  a state/province without a city (admin1, country)
  --   country a country without a finer place (country)
  --   region  one row per member country of a named region place, e.g. on-site "EMEA" (country)
  --   scope   one row per country a REMOTE worker may live in (country); none = unrestricted
  CREATE TABLE job_places (
    job_rid  INTEGER NOT NULL REFERENCES jobs (rid) ON DELETE CASCADE,
    kind     TEXT NOT NULL,       -- city | admin1 | country | region | scope
    city     TEXT,
    admin1   TEXT,
    country  TEXT,
    lat      REAL,
    lon      REAL
  );
  CREATE INDEX job_places_job     ON job_places (job_rid);
  CREATE INDEX job_places_country ON job_places (country, admin1, city);
  CREATE INDEX job_places_lat     ON job_places (lat);
  CREATE INDEX job_places_lon     ON job_places (lon);

  -- Full-text index. Contentless: text lives in jobs / is derived at ingest.
  -- rowid = jobs.rid. Column order matters for bm25() weights.
  CREATE VIRTUAL TABLE jobs_fts USING fts5 (
    title,
    company,
    location,
    tags,       -- source tags + extracted skills + department
    body,       -- description as plain text
    content = '',
    contentless_delete = 1,
    tokenize = "porter unicode61 remove_diacritics 2 tokenchars '+#'"
  );

  -- Syncing -----------------------------------------------------------------
  CREATE TABLE sync_state (
    feed_key             TEXT PRIMARY KEY,   -- 'remotive', 'greenhouse:stripe', ...
    source               TEXT NOT NULL,
    status               TEXT NOT NULL DEFAULT 'idle',  -- idle | queued | running | ok | error
    last_attempt_at      TEXT,
    last_success_at      TEXT,
    error                TEXT,
    etag                 TEXT,
    last_modified        TEXT,
    job_count            INTEGER NOT NULL DEFAULT 0,
    duration_ms          INTEGER,
    consecutive_failures INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX sync_state_source ON sync_state (source);

  CREATE TABLE companies (
    id        TEXT PRIMARY KEY,          -- '<ats>:<token>'
    name      TEXT NOT NULL,
    ats       TEXT NOT NULL,
    token     TEXT NOT NULL,
    industry  TEXT,
    origin    TEXT NOT NULL DEFAULT 'seed',   -- seed | user
    enabled   INTEGER NOT NULL DEFAULT 1,
    added_at  TEXT NOT NULL,
    UNIQUE (ats, token)
  );

  -- User data ---------------------------------------------------------------
  CREATE TABLE settings (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL             -- JSON
  );

  CREATE TABLE profile (
    id          TEXT PRIMARY KEY CHECK (id = 'default'),
    data        TEXT NOT NULL,       -- JSON Profile (without the résumé file bytes)
    updated_at  TEXT NOT NULL
  );

  CREATE TABLE saved_searches (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    query           TEXT NOT NULL,   -- JSON SearchQuery
    pinned          INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    last_viewed_at  TEXT
  );

  CREATE TABLE search_history (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    query   TEXT NOT NULL,           -- JSON SearchQuery
    sig     TEXT NOT NULL,           -- hash of the normalised query, to collapse repeats
    ran_at  TEXT NOT NULL,
    total   INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX search_history_sig ON search_history (sig);

  CREATE TABLE applications (
    id                 TEXT PRIMARY KEY,
    job_id             TEXT,
    cluster_key        TEXT,
    status             TEXT NOT NULL,
    job_snapshot       TEXT NOT NULL,          -- JSON JobSnapshot
    notes              TEXT NOT NULL DEFAULT '',
    priority           INTEGER NOT NULL DEFAULT 0,
    contacts           TEXT NOT NULL DEFAULT '[]',
    checklist          TEXT NOT NULL DEFAULT '[]',
    follow_up_at       TEXT,
    applied_at         TEXT,
    status_changed_at  TEXT NOT NULL,
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL,
    sort_order         REAL NOT NULL DEFAULT 0
  );
  CREATE INDEX applications_status  ON applications (status);
  CREATE INDEX applications_cluster ON applications (cluster_key);
  CREATE INDEX applications_job     ON applications (job_id);

  CREATE TABLE application_events (
    id              TEXT PRIMARY KEY,
    application_id  TEXT NOT NULL REFERENCES applications (id) ON DELETE CASCADE,
    at              TEXT NOT NULL,
    type            TEXT NOT NULL,
    title           TEXT NOT NULL,
    detail          TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX application_events_app ON application_events (application_id, at);

  CREATE TABLE documents (
    id              TEXT PRIMARY KEY,
    application_id  TEXT NOT NULL REFERENCES applications (id) ON DELETE CASCADE,
    kind            TEXT NOT NULL,
    title           TEXT NOT NULL,
    content         TEXT NOT NULL,
    generated_by    TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
  );
  CREATE INDEX documents_app ON documents (application_id);

  -- Keyed by cluster so every copy of a job shares the user's state.
  CREATE TABLE hidden_jobs (
    cluster_key  TEXT PRIMARY KEY,
    job_id       TEXT,
    hidden_at    TEXT NOT NULL
  );
  CREATE TABLE job_views (
    cluster_key  TEXT PRIMARY KEY,
    job_id       TEXT,
    viewed_at    TEXT NOT NULL
  );
  `,
];
