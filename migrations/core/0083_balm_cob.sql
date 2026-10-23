-- INS-013: a payer stage exists even when crossover creates no outgoing claim.
CREATE TABLE bm_cob_stages (
 invoice_id TEXT NOT NULL REFERENCES bm_invoices(id), policy_id TEXT NOT NULL REFERENCES bm_policies(id),
 priority INTEGER NOT NULL CHECK(priority BETWEEN 1 AND 3),
 state TEXT NOT NULL DEFAULT 'waiting' CHECK(state IN ('waiting','unsent','sent','crossover','adjudicated','denied','reopened')),
 claim_id TEXT REFERENCES bm_claims(id), source_claim_id TEXT REFERENCES bm_claims(id),
 updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
 PRIMARY KEY(invoice_id,policy_id), UNIQUE(invoice_id,priority)
);
CREATE TABLE bm_cob_adjudications (
 id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL, policy_id TEXT NOT NULL,
 claim_id TEXT NOT NULL REFERENCES bm_claims(id), source_kind TEXT NOT NULL CHECK(source_kind IN ('835','paper_eob')),
 source_id TEXT NOT NULL, payer_control TEXT NOT NULL, paid_cents INTEGER NOT NULL CHECK(paid_cents>=0),
 detail TEXT NOT NULL CHECK(json_valid(detail)), recorded_at TEXT NOT NULL,
 FOREIGN KEY(invoice_id,policy_id) REFERENCES bm_cob_stages(invoice_id,policy_id), UNIQUE(invoice_id,policy_id,source_kind,source_id)
);
CREATE TRIGGER bm_cob_adjudications_fixed BEFORE UPDATE ON bm_cob_adjudications BEGIN SELECT RAISE(ABORT,'cob_adjudication_fixed'); END;
CREATE TRIGGER bm_cob_adjudications_kept BEFORE DELETE ON bm_cob_adjudications WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_cob_adjudications' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'cob_adjudication_fixed'); END;
CREATE TABLE bm_cob_wait_settings (
 id INTEGER PRIMARY KEY CHECK(id=1), wait_days INTEGER NOT NULL CHECK(wait_days BETWEEN 1 AND 730), source TEXT NOT NULL,
 recorded_by TEXT NOT NULL, recorded_at TEXT NOT NULL
);
CREATE TABLE bm_cob_patient_decisions (
 invoice_id TEXT PRIMARY KEY REFERENCES bm_invoices(id), reason TEXT NOT NULL, decided_by TEXT NOT NULL, decided_at TEXT NOT NULL,
 wait_days INTEGER NOT NULL, source TEXT NOT NULL
);
CREATE TRIGGER bm_cob_decisions_fixed BEFORE UPDATE ON bm_cob_patient_decisions BEGIN SELECT RAISE(ABORT,'cob_decision_fixed'); END;
CREATE TRIGGER bm_cob_decisions_kept BEFORE DELETE ON bm_cob_patient_decisions WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_cob_patient_decisions' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'cob_decision_fixed'); END;
-- Existing claims keep their originals. Older EOBs without line dates cannot be
-- sent onward until the biller records the original line adjudication facts.
INSERT INTO bm_cob_stages(invoice_id,policy_id,priority,state,claim_id,updated_at)
 SELECT v.invoice_id,p.id,p.priority,
 COALESCE((SELECT CASE WHEN q.status IN ('paid','partial') THEN 'adjudicated' WHEN q.status IN ('draft','ready','batched','exported') THEN 'unsent' WHEN q.status='denied' THEN 'denied' ELSE 'sent' END
  FROM bm_claims q WHERE q.invoice_id=v.invoice_id AND q.policy_id=p.id AND q.status<>'corrected' ORDER BY q.created_at DESC,q.id DESC LIMIT 1),'waiting'),
 (SELECT q.id FROM bm_claims q WHERE q.invoice_id=v.invoice_id AND q.policy_id=p.id AND q.status<>'corrected' ORDER BY q.created_at DESC,q.id DESC LIMIT 1),
 (SELECT MAX(q.updated_at) FROM bm_claims q WHERE q.invoice_id=v.invoice_id)
 FROM (SELECT DISTINCT invoice_id,client_id,service_date FROM bm_claims WHERE status<>'corrected') v
 JOIN bm_policies p ON p.client_id=v.client_id AND p.starts_on<=v.service_date AND (p.ends_on='' OR p.ends_on IS NULL OR p.ends_on>=v.service_date)
 WHERE NOT EXISTS(SELECT 1 FROM bm_policies x WHERE x.client_id=v.client_id AND x.starts_on<=v.service_date AND (x.ends_on='' OR x.ends_on IS NULL OR x.ends_on>=v.service_date) GROUP BY x.priority HAVING COUNT(*)>1);
CREATE VIEW bm_invoice_insurance_hold AS
 SELECT i.id AS invoice_id,
 COALESCE((SELECT y.name FROM bm_cob_stages s JOIN bm_policies p ON p.id=s.policy_id JOIN bm_payers y ON y.id=p.payer_id WHERE s.invoice_id=i.id AND s.state<>'adjudicated' ORDER BY s.priority LIMIT 1),
 (SELECT y.name FROM bm_claims c JOIN bm_policies p ON p.id=c.policy_id JOIN bm_payers y ON y.id=p.payer_id WHERE c.invoice_id=i.id AND c.status NOT IN ('corrected','paid','partial') LIMIT 1),'COB policy order needs review') AS payer
 FROM bm_invoices i WHERE NOT EXISTS(SELECT 1 FROM bm_cob_patient_decisions d WHERE d.invoice_id=i.id)
 AND (EXISTS(SELECT 1 FROM bm_cob_stages s WHERE s.invoice_id=i.id AND s.state<>'adjudicated')
 OR EXISTS(SELECT 1 FROM bm_claims c WHERE c.invoice_id=i.id AND c.status NOT IN ('corrected','paid','partial'))
 OR EXISTS(SELECT 1 FROM bm_claims q JOIN bm_policies p ON p.client_id=q.client_id AND p.starts_on<=q.service_date AND (p.ends_on='' OR p.ends_on IS NULL OR p.ends_on>=q.service_date)
 WHERE q.invoice_id=i.id AND q.status<>'corrected' GROUP BY q.service_date,p.priority HAVING COUNT(DISTINCT p.id)>1));
ALTER TABLE bm_payer_payment_lines ADD COLUMN procedure_code TEXT NOT NULL DEFAULT '';
ALTER TABLE bm_payer_payment_lines ADD COLUMN procedure_modifiers TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(procedure_modifiers));
ALTER TABLE bm_payer_payment_lines ADD COLUMN paid_units INTEGER;
ALTER TABLE bm_payer_payment_lines ADD COLUMN adjudicated_on TEXT NOT NULL DEFAULT '';
CREATE TABLE bm_cob_paper_packets (
 id TEXT PRIMARY KEY, claim_id TEXT NOT NULL REFERENCES bm_claims(id), claim_version INTEGER NOT NULL, body TEXT NOT NULL, sha256 TEXT NOT NULL,
 eob_base64 TEXT NOT NULL, eob_mime TEXT NOT NULL, eob_sha256 TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
 submitted_at TEXT, submitted_by TEXT, reference TEXT
);

-- Original paper EOB amounts remain immutable; only the incremental reduction
-- not already taken by an earlier payer reduces the primary invoice.
CREATE TABLE bm_cob_manual_reductions (
 line_id TEXT PRIMARY KEY REFERENCES bm_payer_payment_lines(id), amount_cents INTEGER NOT NULL CHECK(amount_cents>=0)
);
CREATE TRIGGER bm_cob_reductions_fixed BEFORE UPDATE ON bm_cob_manual_reductions BEGIN SELECT RAISE(ABORT,'cob_reduction_fixed'); END;
CREATE TRIGGER bm_cob_reductions_kept BEFORE DELETE ON bm_cob_manual_reductions WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_cob_manual_reductions' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'cob_reduction_fixed'); END;
DROP VIEW bm_invoice_adjustments;
CREATE VIEW bm_invoice_adjustments AS
 SELECT id,invoice_id,amount_cents,reason,recorded_by,recorded_at,'insurance' AS source FROM bm_insurance_adjustments
 UNION ALL SELECT id,invoice_id,amount_cents,reason,approved_by,posted_at,'manual' FROM bm_posted_account_entries WHERE kind IN ('adjustment','write_off')
 UNION ALL SELECT l.id,l.invoice_id,COALESCE(c.amount_cents,l.adjustment_cents),'Paper EOB · '||l.adjustments,b.closed_by,b.closed_at,'insurance'
 FROM bm_payer_payment_lines l JOIN bm_payer_payment_batches b ON b.id=l.batch_id LEFT JOIN bm_cob_manual_reductions c ON c.line_id=l.id
 WHERE b.status='closed' AND l.kind='payment' AND COALESCE(c.amount_cents,l.adjustment_cents)>0;

CREATE TRIGGER bm_cob_paper_fixed BEFORE UPDATE ON bm_cob_paper_packets WHEN OLD.submitted_at IS NOT NULL OR NEW.claim_id<>OLD.claim_id OR NEW.claim_version<>OLD.claim_version OR NEW.body<>OLD.body OR NEW.sha256<>OLD.sha256 OR NEW.eob_base64<>OLD.eob_base64 OR NEW.eob_mime<>OLD.eob_mime OR NEW.eob_sha256<>OLD.eob_sha256 OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at BEGIN SELECT RAISE(ABORT,'paper_original_fixed'); END;
CREATE TRIGGER bm_cob_paper_kept BEFORE DELETE ON bm_cob_paper_packets WHEN NOT EXISTS(SELECT 1 FROM bm_retention_scope s JOIN bm_retention_permits p ON p.preview_id=s.preview_id WHERE s.table_name='bm_cob_paper_packets' AND s.record_rowid=OLD.rowid) BEGIN SELECT RAISE(ABORT,'paper_original_kept'); END;
CREATE TRIGGER bm_cob_adjudications_retention_insert AFTER INSERT ON bm_cob_adjudications BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_cob_adjudications_retention_update AFTER UPDATE ON bm_cob_adjudications BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_cob_adjudications_retention_delete AFTER DELETE ON bm_cob_adjudications BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_cob_patient_decisions_retention_insert AFTER INSERT ON bm_cob_patient_decisions BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_cob_patient_decisions_retention_update AFTER UPDATE ON bm_cob_patient_decisions BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_cob_patient_decisions_retention_delete AFTER DELETE ON bm_cob_patient_decisions BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_cob_manual_reductions_retention_insert AFTER INSERT ON bm_cob_manual_reductions BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_cob_manual_reductions_retention_update AFTER UPDATE ON bm_cob_manual_reductions BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_cob_manual_reductions_retention_delete AFTER DELETE ON bm_cob_manual_reductions BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_cob_stages_retention_insert AFTER INSERT ON bm_cob_stages BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_cob_stages_retention_update AFTER UPDATE ON bm_cob_stages BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_cob_stages_retention_delete AFTER DELETE ON bm_cob_stages BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_cob_paper_packets_retention_insert AFTER INSERT ON bm_cob_paper_packets BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_cob_paper_packets_retention_update AFTER UPDATE ON bm_cob_paper_packets BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
CREATE TRIGGER bm_cob_paper_packets_retention_delete AFTER DELETE ON bm_cob_paper_packets BEGIN UPDATE bm_retention_epoch SET version=version+1 WHERE id=1; END;
