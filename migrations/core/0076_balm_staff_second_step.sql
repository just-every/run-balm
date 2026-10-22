-- Staff factors and session proofs are credentials and never exported.
CREATE TABLE bm_staff_security_policy (id INTEGER PRIMARY KEY CHECK(id=1),require_all INTEGER NOT NULL DEFAULT 0 CHECK(require_all IN (0,1)),idle_minutes INTEGER NOT NULL DEFAULT 15 CHECK(idle_minutes BETWEEN 1 AND 120));
INSERT INTO bm_staff_security_policy(id) VALUES(1);
CREATE TABLE bm_staff_factors (operator_id TEXT PRIMARY KEY REFERENCES oa_operators(id),sealed_seed TEXT NOT NULL,last_step INTEGER NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE bm_staff_factor_pending (session_id TEXT PRIMARY KEY,operator_id TEXT NOT NULL,sealed_seed TEXT NOT NULL,expires_at INTEGER NOT NULL);
CREATE TABLE bm_staff_recovery (operator_id TEXT NOT NULL,code_hash TEXT NOT NULL,used_at INTEGER,PRIMARY KEY(operator_id,code_hash));
CREATE TABLE bm_staff_session_proofs (session_id TEXT PRIMARY KEY,operator_id TEXT NOT NULL,verified_at INTEGER NOT NULL,last_seen_at INTEGER NOT NULL,device TEXT NOT NULL);
CREATE TABLE bm_staff_factor_attempts (operator_id TEXT PRIMARY KEY,window INTEGER NOT NULL,count INTEGER NOT NULL);
