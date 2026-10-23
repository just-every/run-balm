-- Payer-authored requirements; absent configuration never invents a payer rule.
CREATE TABLE bm_payer_claim_requirements (
 payer_id TEXT PRIMARY KEY REFERENCES bm_payers(id),
 authorization INTEGER NOT NULL CHECK(authorization IN (0,1)),
 certification INTEGER NOT NULL CHECK(certification IN (0,1)),
 filing INTEGER NOT NULL CHECK(filing IN (0,1)), source TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1
);
