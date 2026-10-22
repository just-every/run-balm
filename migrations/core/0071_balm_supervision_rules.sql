-- The owner records clinical discipline explicitly; unclassified legacy staff
-- cannot supervise until it is recorded. Earlier signatures remain unchanged.
ALTER TABLE bm_staff ADD COLUMN discipline TEXT NOT NULL DEFAULT '' CHECK(discipline IN ('','pt','ot','slp'));
ALTER TABLE bm_note_submissions ADD COLUMN author_kind TEXT NOT NULL DEFAULT '';
ALTER TABLE bm_note_submissions ADD COLUMN author_discipline TEXT NOT NULL DEFAULT '';
ALTER TABLE bm_note_reviews ADD COLUMN supervision_given TEXT NOT NULL DEFAULT '' CHECK(supervision_given IN ('','in_room','on_site','general'));
ALTER TABLE bm_payers ADD COLUMN supervision_minimum TEXT NOT NULL DEFAULT 'in_room' CHECK(supervision_minimum IN ('in_room','on_site','general'));
ALTER TABLE bm_payers ADD COLUMN supervision_billable INTEGER NOT NULL DEFAULT 0 CHECK(supervision_billable IN (0,1));
ALTER TABLE bm_payers ADD COLUMN supervision_rule_recorded INTEGER NOT NULL DEFAULT 0 CHECK(supervision_rule_recorded IN (0,1));
