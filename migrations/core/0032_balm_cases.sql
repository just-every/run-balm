-- The case agent: one case per referral. A case's stage and next steps are
-- computed from the clinic's records on every read; only the referral itself,
-- drafted wording and each approved step are stored. An approved step is kept
-- with who approved it, the digest of the facts it was approved on and the
-- exact wording sent, and can never change.
CREATE TABLE bm_referrals (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES bm_clients(id), policy_id TEXT REFERENCES bm_policies(id),
 received_on TEXT NOT NULL, referring_first TEXT NOT NULL, referring_last TEXT NOT NULL, referring_npi TEXT NOT NULL DEFAULT '',
 diagnosis TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL DEFAULT '', authorization_email TEXT NOT NULL DEFAULT '',
 created_by TEXT NOT NULL, created_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX bm_referrals_client ON bm_referrals(client_id,received_on);
CREATE TABLE bm_case_drafts (
 referral_id TEXT NOT NULL REFERENCES bm_referrals(id), step_key TEXT NOT NULL, wording TEXT NOT NULL,
 drafted_by TEXT NOT NULL, drafted_at TEXT NOT NULL, PRIMARY KEY(referral_id,step_key)
);
CREATE TABLE bm_case_steps (
 id TEXT PRIMARY KEY, referral_id TEXT NOT NULL REFERENCES bm_referrals(id), step_key TEXT NOT NULL,
 kind TEXT NOT NULL, title TEXT NOT NULL, digest TEXT NOT NULL, citations TEXT NOT NULL CHECK(json_valid(citations)),
 wording TEXT NOT NULL DEFAULT '', approved_by TEXT NOT NULL, approved_role TEXT NOT NULL, approved_at TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('sending','done','failed')), result TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(result)),
 finished_at TEXT
);
CREATE UNIQUE INDEX bm_case_step_once ON bm_case_steps(referral_id,step_key) WHERE status<>'failed';
CREATE INDEX bm_case_steps_referral ON bm_case_steps(referral_id,approved_at);
CREATE TRIGGER bm_case_steps_kept BEFORE DELETE ON bm_case_steps BEGIN SELECT RAISE(ABORT,'case_step_kept'); END;
CREATE TRIGGER bm_case_steps_fixed BEFORE UPDATE ON bm_case_steps WHEN OLD.status<>'sending' BEGIN SELECT RAISE(ABORT,'case_step_kept'); END;
