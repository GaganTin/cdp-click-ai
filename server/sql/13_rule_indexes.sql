-- ============================================================================
-- 13_rule_indexes.sql
-- Supporting indexes for Rule-attribute relation conditions (segment / pop-up /
-- EDM / attribute / purchases). Every statement is IF NOT EXISTS so this file is
-- safe to re-run and safe to apply to a live database without a teardown.
-- ============================================================================

-- EDM: "received / opened / clicked campaign X" correlate edm_sends / edm_events
-- to a profile by member_id or LOWER(email).
CREATE INDEX IF NOT EXISTS edm_sends_member_idx        ON app.edm_sends(member_id);
CREATE INDEX IF NOT EXISTS edm_sends_lower_email_idx   ON app.edm_sends(LOWER(email));
CREATE INDEX IF NOT EXISTS edm_events_campaign_type_idx ON app.edm_events(edm_campaign_id, event_type);
CREATE INDEX IF NOT EXISTS edm_events_lower_email_idx  ON app.edm_events(LOWER(email));

-- Pop-ups: "submitted form" correlates popup_email_collected by member/email
-- (customer) or visitor_id (anonymous), scoped to a single pop-up.
CREATE INDEX IF NOT EXISTS popup_email_collected_popup_profile_idx ON app.popup_email_collected(popup_id, profile_id);
CREATE INDEX IF NOT EXISTS popup_email_collected_popup_visitor_idx ON app.popup_email_collected(popup_id, visitor_id);

-- Purchases: order count / spend / last order correlate shopify.sale by member_id
-- (the rule subquery filters member_id without a company_id, so the existing
-- (company_id, member_id) composite can't serve it).
CREATE INDEX IF NOT EXISTS shopify_sale_member_only_idx ON shopify.sale(member_id);

-- Attribute-value relation: EXISTS on profile_attribute_values matches by
-- (entity_type, entity_id, attribute_value_id) without a company filter
-- (attribute_value_id is already company-specific via FK).
CREATE INDEX IF NOT EXISTS profile_attr_value_entity_value_idx
  ON app.profile_attribute_values(entity_type, entity_id, attribute_value_id);

-- Pop-up "has seen / clicked" (anonymous) reads the interaction microservice
-- schema, joining interaction.activities (by capsuite_apid) to
-- interaction.interactions (by cdp_reference_id). Guarded - that schema may be
-- absent in some deployments.
DO $$
BEGIN
  IF to_regclass('interaction.activities') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS interaction_activities_apid_idx ON interaction.activities(capsuite_apid);
  END IF;
  IF to_regclass('interaction.interactions') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS interaction_interactions_ref_idx ON interaction.interactions(cdp_reference_id);
  END IF;
END $$;
