-- Keep the legacy CMS/AMA CHECK intact. A positive fixed threshold is an
-- alternative to that legacy method, never a hidden override of it.
ALTER TABLE bm_payers ADD COLUMN fixed_unit_minutes INTEGER
  CHECK(fixed_unit_minutes IS NULL OR (typeof(fixed_unit_minutes)='integer' AND fixed_unit_minutes>0 AND unit_method IS NULL AND medicare=0));
