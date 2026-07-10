-- 2026-07-09  Durable projection of pop-up outbound link clicks.
-- ----------------------------------------------------------------------------
-- Adds app.popup_link_clicks + the interaction.project_link_click() trigger,
-- mirroring the email_collection projection. Every `click_interaction` activity
-- becomes one row carrying the destination link_url (full query string kept, so
-- a WhatsApp wa.me deep-link and its prefilled ?text= stay distinct/preserved).
-- Backfills clicks that predate the trigger. Idempotent (safe to re-run).
-- The final state here is already folded into server/sql/05_popups.sql and
-- server/sql/11_interaction.sql; this file upgrades pre-existing databases.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS app.popup_link_clicks (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clicked_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  company_id    UUID        NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  popup_id      UUID        REFERENCES app.popups(id) ON DELETE SET NULL,
  popup_name    TEXT,
  popup_ref     TEXT,
  link_url      TEXT        NOT NULL,
  link_text     TEXT,
  link_target   TEXT,
  open_method   TEXT,
  source_url    TEXT,
  visitor_id    TEXT,
  session_id    TEXT,
  metadata      JSONB       NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS popup_link_clicks_company_idx ON app.popup_link_clicks(company_id);
CREATE INDEX IF NOT EXISTS popup_link_clicks_popup_idx   ON app.popup_link_clicks(popup_id);
CREATE INDEX IF NOT EXISTS popup_link_clicks_clicked_idx ON app.popup_link_clicks(clicked_at DESC);
CREATE INDEX IF NOT EXISTS popup_link_clicks_url_idx     ON app.popup_link_clicks(popup_id, link_url);

CREATE OR REPLACE FUNCTION interaction.project_link_click() RETURNS trigger AS $$
DECLARE
  v_json        jsonb;
  v_link        text;
  v_ref         text;
  v_cdp_company uuid;
  v_popup       app.popups%ROWTYPE;
BEGIN
  BEGIN
    v_json := NEW.json_parameters::jsonb;
  EXCEPTION WHEN others THEN
    v_json := '{}'::jsonb;
  END;

  v_link := NULLIF(btrim(v_json->>'link_url'), '');
  IF v_link IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT i.cdp_reference_id, c.cdp_company_id
    INTO v_ref, v_cdp_company
    FROM interaction.interactions i
    JOIN interaction.companies c ON c.id = i.company_id
   WHERE i.id = NEW.correlated_interaction_id;

  IF v_cdp_company IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_popup
    FROM app.popups
   WHERE company_id = v_cdp_company AND cdp_reference_id = v_ref
   LIMIT 1;

  INSERT INTO app.popup_link_clicks (
    clicked_at, company_id, popup_id, popup_name, popup_ref,
    link_url, link_text, link_target, open_method,
    source_url, visitor_id, session_id, metadata
  ) VALUES (
    NEW.created_at, v_cdp_company, v_popup.id, v_popup.name, v_ref,
    v_link,
    NULLIF(v_json->>'link_text',''), NULLIF(v_json->>'link_target',''), NULLIF(v_json->>'open_method',''),
    COALESCE(NULLIF(v_json->>'post_url',''), NULLIF(v_json->>'source_url','')),
    NEW.capsuite_apid, NEW.capsuite_sid,
    jsonb_build_object('source','interaction_activity','activity_id', NEW.id)
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS activities_project_link_click ON interaction.activities;
CREATE TRIGGER activities_project_link_click
  AFTER INSERT ON interaction.activities
  FOR EACH ROW
  WHEN (NEW.action = 'click_interaction')
  EXECUTE FUNCTION interaction.project_link_click();

-- Backfill historical clicks recorded before the trigger existed. Deduped on the
-- source activity id so re-running the migration never double-inserts.
INSERT INTO app.popup_link_clicks (
  clicked_at, company_id, popup_id, popup_name, popup_ref,
  link_url, link_text, link_target, open_method,
  source_url, visitor_id, session_id, metadata
)
SELECT
  a.created_at, c.cdp_company_id, p.id, p.name, i.cdp_reference_id,
  NULLIF(btrim((a.json_parameters)::jsonb->>'link_url'), ''),
  NULLIF((a.json_parameters)::jsonb->>'link_text', ''),
  NULLIF((a.json_parameters)::jsonb->>'link_target', ''),
  NULLIF((a.json_parameters)::jsonb->>'open_method', ''),
  COALESCE(NULLIF((a.json_parameters)::jsonb->>'post_url',''), NULLIF((a.json_parameters)::jsonb->>'source_url','')),
  a.capsuite_apid, a.capsuite_sid,
  jsonb_build_object('source','backfill','activity_id', a.id)
FROM interaction.activities a
JOIN interaction.interactions i ON i.id = a.correlated_interaction_id
JOIN interaction.companies   c ON c.id = i.company_id
LEFT JOIN app.popups p ON p.company_id = c.cdp_company_id AND p.cdp_reference_id = i.cdp_reference_id
WHERE a.action = 'click_interaction'
  AND a.json_parameters LIKE '{%'
  AND NULLIF(btrim((a.json_parameters)::jsonb->>'link_url'), '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM app.popup_link_clicks lc
    WHERE lc.metadata->>'activity_id' = a.id::text
  );
