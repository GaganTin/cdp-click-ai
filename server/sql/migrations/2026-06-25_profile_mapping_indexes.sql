-- Profile-mapping support indexes (build_profile_mapping DAG + Node refreshProfiles).
-- Non-destructive; safe to re-run. IF NOT EXISTS so this is idempotent on the live DB.

-- capsuite_uid lookup: logged-in visitor -> known member (mapping methods 2/3b).
CREATE INDEX IF NOT EXISTS gal_pe_company_uid_idx
  ON ga_landing.path_exploration(company_id, capsuite_uid);

-- trxn_id lookup: GA purchase -> commerce/manual order -> buyer (mapping method 1/1b).
CREATE INDEX IF NOT EXISTS gal_pl_company_trxn_idx
  ON ga_landing.purchase_list(company_id, trxn_id);
