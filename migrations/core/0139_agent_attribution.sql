-- Native activity keeps the current sponsor and the distinct preparing agent.
ALTER TABLE bm_audit ADD COLUMN agent_id TEXT;
ALTER TABLE bm_audit ADD COLUMN agent_name TEXT;
ALTER TABLE bm_audit ADD COLUMN sponsor_id TEXT;
ALTER TABLE bm_audit ADD COLUMN sponsor_name TEXT;
ALTER TABLE bm_audit ADD COLUMN operation_id TEXT;
ALTER TABLE bm_audit ADD COLUMN approvers TEXT;
