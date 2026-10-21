-- INTAKE-002: published packets and submitted scores retain their exact version.
ALTER TABLE bm_intake_forms ADD COLUMN service_id TEXT REFERENCES bm_services(id);
ALTER TABLE bm_intake_forms ADD COLUMN discipline TEXT NOT NULL DEFAULT '' CHECK(discipline IN ('','pt','ot','slp','pediatric'));
ALTER TABLE bm_intake_forms ADD COLUMN instruments TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(instruments));
ALTER TABLE bm_intake_responses ADD COLUMN scores TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(scores));
ALTER TABLE bm_services ADD COLUMN intake_discipline TEXT NOT NULL DEFAULT '' CHECK(intake_discipline IN ('','pt','ot','slp','pediatric'));
CREATE INDEX bm_intake_packet_scope ON bm_intake_forms(service_id,discipline,number);
