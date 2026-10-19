-- Transport receipts contain only a payload digest and note identity/revision.
-- This domain table travels with the existing whole-clinic archive policy.
CREATE TABLE bm_draft_requests (
 actor_id TEXT NOT NULL,
 request_id TEXT NOT NULL,
 digest TEXT NOT NULL CHECK(length(digest)=64),
 result TEXT NOT NULL CHECK(json_valid(result)),
 created_at TEXT NOT NULL,
 PRIMARY KEY(actor_id,request_id)
);
CREATE TRIGGER bm_draft_requests_no_update BEFORE UPDATE ON bm_draft_requests
 BEGIN SELECT RAISE(ABORT,'draft_request_append_only'); END;
