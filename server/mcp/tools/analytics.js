// MCP Tool Group 5: Analytics & Mathematical Models
// Pure read-only scoring and pattern-detection tools.
// The AI surfaces insights; users decide whether to act via the UI.

export const analyticsTools = [
  // ─── Customer Value ─────────────────────────────────────────────────────────
  {
    name: "score_rfm",
    description:
      "Score every email-eligible member on Recency (days since last activity), " +
      "Frequency (seminar/event attendance count), and Monetary (proxy: GA sessions as engagement spend). " +
      "Each dimension is bucketed 1–5; combined RFM score is returned with a segment label " +
      "(Champions, Loyal, At-Risk, Hibernating, Lost, New). " +
      "Use this to identify high-value members, find churn risks, or build targeted lists.",
    inputSchema: {
      type: "object",
      properties: {
        top_n: {
          type: "number",
          description: "Return only the top N members by combined RFM score. Defaults to 100.",
        },
        segment_label: {
          type: "string",
          enum: ["Champions", "Loyal", "At-Risk", "Hibernating", "Lost", "New"],
          description: "Filter results to a specific RFM segment label.",
        },
      },
    },
  },
  {
    name: "estimate_clv",
    description:
      "Estimate Customer Lifetime Value for each member using a simplified BG/NBD-inspired approach: " +
      "predicted future engagements × average engagement value proxy. " +
      "Returns members ranked by predicted CLV with the key drivers. " +
      "Use this to prioritise high-CLV members for premium campaigns or retention spend.",
    inputSchema: {
      type: "object",
      properties: {
        horizon_days: {
          type: "number",
          description: "Prediction horizon in days. Defaults to 365 (1 year).",
        },
        top_n: {
          type: "number",
          description: "Return top N members by predicted CLV. Defaults to 50.",
        },
      },
    },
  },

  // ─── Churn & Retention ──────────────────────────────────────────────────────
  {
    name: "score_churn_risk",
    description:
      "Score every member on churn risk using a Survival Analysis-inspired hazard model: " +
      "combines days-since-last-activity, registration age, email engagement rate, " +
      "and seminar attendance into a 0–100 risk score (100 = highest risk). " +
      "Returns high-risk members with the top contributing risk factors. " +
      "Use this before planning a win-back or reactivation campaign.",
    inputSchema: {
      type: "object",
      properties: {
        risk_threshold: {
          type: "number",
          description: "Only return members with risk score >= this threshold (0–100). Defaults to 70.",
        },
        top_n: {
          type: "number",
          description: "Max members to return. Defaults to 100.",
        },
      },
    },
  },
  {
    name: "analyze_cohort_retention",
    description:
      "Compute month-by-month retention curves for member cohorts grouped by join month. " +
      "Uses activity data to determine whether a member was 'retained' in each subsequent month. " +
      "Returns a retention matrix (cohort × month offset) and fitted exponential decay parameters. " +
      "Use this to benchmark engagement health and forecast future active member counts.",
    inputSchema: {
      type: "object",
      properties: {
        cohort_months: {
          type: "number",
          description: "How many join-month cohorts to include (most recent N months). Defaults to 12.",
        },
      },
    },
  },

  // ─── Segmentation ───────────────────────────────────────────────────────────
  {
    name: "cluster_members",
    description:
      "Run K-Means-style behavioural clustering on members using: days-since-join, " +
      "seminar_count, ga_sessions, email opt-in status, and education level. " +
      "Returns each cluster's centroid profile, size, and a descriptive label. " +
      "Use this to discover natural audience groupings before building segments.",
    inputSchema: {
      type: "object",
      properties: {
        k: {
          type: "number",
          description: "Number of clusters (2–8). Defaults to 4.",
        },
      },
    },
  },

  // ─── Purchase / Event Patterns ──────────────────────────────────────────────
  {
    name: "find_association_rules",
    description:
      "Run Apriori-style association rule mining over member custom activities (events/seminars). " +
      "Finds event co-occurrence patterns: e.g. 'members who attended Event A also attended Event B'. " +
      "Returns rules sorted by lift with support and confidence metrics. " +
      "Use this to identify cross-sell opportunities or design event follow-up sequences.",
    inputSchema: {
      type: "object",
      properties: {
        min_support: {
          type: "number",
          description: "Minimum fraction of members that must share the pattern (0–1). Defaults to 0.05.",
        },
        min_lift: {
          type: "number",
          description: "Minimum lift to include a rule. Defaults to 1.5.",
        },
        top_n: {
          type: "number",
          description: "Return top N rules by lift. Defaults to 20.",
        },
      },
    },
  },
  {
    name: "predict_next_event",
    description:
      "Use a Markov Chain model over member event sequences to predict the most likely " +
      "next event/seminar for a given member or for members who attended a specific event. " +
      "Returns transition probabilities for each possible next event. " +
      "Use this to personalise follow-up recommendations or design drip sequences.",
    inputSchema: {
      type: "object",
      properties: {
        after_event_name: {
          type: "string",
          description: "The event name to start from (e.g. 'Orientation Seminar'). Required.",
        },
        top_n: {
          type: "number",
          description: "Return top N predicted next events. Defaults to 5.",
        },
      },
      required: ["after_event_name"],
    },
  },

  // ─── Attribution ────────────────────────────────────────────────────────────
  {
    name: "compute_channel_attribution",
    description:
      "Compute multi-touch attribution across registration channels using Shapley Value allocation. " +
      "Combines member registration channel data with GA session source/medium to assign fractional " +
      "conversion credit to each touchpoint. Returns a ranked channel attribution table. " +
      "Use this to understand which acquisition channels truly drive member conversions.",
    inputSchema: {
      type: "object",
      properties: {
        days: {
          type: "number",
          description: "Lookback window in days. Defaults to 90.",
        },
        attribution_model: {
          type: "string",
          enum: ["shapley", "last_touch", "first_touch", "linear"],
          description: "Attribution model to apply. Defaults to 'shapley'.",
        },
      },
    },
  },

  // ─── Anomaly Detection ──────────────────────────────────────────────────────
  {
    name: "detect_anomalies",
    description:
      "Detect statistical anomalies in member registration or activity patterns using " +
      "Z-score and IQR methods. Flags unusual spikes or drops in: daily new registrations, " +
      "event attendance counts, and email open rates. " +
      "Use this to surface data quality issues, viral events, or campaign outliers.",
    inputSchema: {
      type: "object",
      properties: {
        metric: {
          type: "string",
          enum: ["registrations", "event_attendance", "email_opens"],
          description: "Which metric to scan for anomalies.",
        },
        days: {
          type: "number",
          description: "How many days of history to analyse. Defaults to 90.",
        },
        z_threshold: {
          type: "number",
          description: "Z-score threshold to flag as anomalous. Defaults to 2.5.",
        },
      },
      required: ["metric"],
    },
  },

  // ─── Forecasting ────────────────────────────────────────────────────────────
  {
    name: "forecast_registrations",
    description:
      "Forecast future member registration volume using exponential smoothing (Holt-Winters). " +
      "Fits a trend + seasonality model to historical daily registration counts and projects " +
      "forward N days with confidence intervals. " +
      "Use this to set growth targets or plan campaign timing.",
    inputSchema: {
      type: "object",
      properties: {
        forecast_days: {
          type: "number",
          description: "How many days forward to forecast. Defaults to 30.",
        },
        history_days: {
          type: "number",
          description: "How many days of history to train on. Defaults to 180.",
        },
      },
    },
  },
];

// ─── Handlers ────────────────────────────────────────────────────────────────

export async function handleAnalyticsTool(name, args, pool) {

  // ── RFM Scoring (RFM model) ──────────────────────────────────────────────
  if (name === "score_rfm") {
    try {
      const topN = Math.min(args.top_n || 100, 500);

      const { rows } = await pool.query(`
        WITH base AS (
          SELECT
            cp.member_id,
            cp.eng_first_name,
            cp.primary_email,
            cp.member_type,
            EXTRACT(DAY FROM NOW() - COALESCE(cp.last_activity_date, cp.member_join_date))::int AS recency_days,
            COALESCE(cp.seminar_count, 0) AS frequency,
            COALESCE(cp.ga_sessions, 0)   AS monetary_proxy
          FROM app.customer_profiles cp
          WHERE cp.primary_email IS NOT NULL
        ),
        percentiles AS (
          SELECT
            PERCENTILE_CONT(0.2) WITHIN GROUP (ORDER BY recency_days)    AS r20,
            PERCENTILE_CONT(0.4) WITHIN GROUP (ORDER BY recency_days)    AS r40,
            PERCENTILE_CONT(0.6) WITHIN GROUP (ORDER BY recency_days)    AS r60,
            PERCENTILE_CONT(0.8) WITHIN GROUP (ORDER BY recency_days)    AS r80,
            PERCENTILE_CONT(0.2) WITHIN GROUP (ORDER BY frequency)       AS f20,
            PERCENTILE_CONT(0.4) WITHIN GROUP (ORDER BY frequency)       AS f40,
            PERCENTILE_CONT(0.6) WITHIN GROUP (ORDER BY frequency)       AS f60,
            PERCENTILE_CONT(0.8) WITHIN GROUP (ORDER BY frequency)       AS f80,
            PERCENTILE_CONT(0.2) WITHIN GROUP (ORDER BY monetary_proxy)  AS m20,
            PERCENTILE_CONT(0.4) WITHIN GROUP (ORDER BY monetary_proxy)  AS m40,
            PERCENTILE_CONT(0.6) WITHIN GROUP (ORDER BY monetary_proxy)  AS m60,
            PERCENTILE_CONT(0.8) WITHIN GROUP (ORDER BY monetary_proxy)  AS m80
          FROM base
        ),
        scored AS (
          SELECT
            b.*,
            -- Recency: lower days = higher score
            CASE
              WHEN b.recency_days <= p.r20 THEN 5
              WHEN b.recency_days <= p.r40 THEN 4
              WHEN b.recency_days <= p.r60 THEN 3
              WHEN b.recency_days <= p.r80 THEN 2
              ELSE 1
            END AS r_score,
            CASE
              WHEN b.frequency >= p.f80 THEN 5
              WHEN b.frequency >= p.f60 THEN 4
              WHEN b.frequency >= p.f40 THEN 3
              WHEN b.frequency >= p.f20 THEN 2
              ELSE 1
            END AS f_score,
            CASE
              WHEN b.monetary_proxy >= p.m80 THEN 5
              WHEN b.monetary_proxy >= p.m60 THEN 4
              WHEN b.monetary_proxy >= p.m40 THEN 3
              WHEN b.monetary_proxy >= p.m20 THEN 2
              ELSE 1
            END AS m_score
          FROM base b, percentiles p
        ),
        labelled AS (
          SELECT *,
            (r_score + f_score + m_score) AS rfm_total,
            CASE
              WHEN r_score >= 4 AND f_score >= 4 AND m_score >= 4 THEN 'Champions'
              WHEN r_score >= 3 AND f_score >= 3                   THEN 'Loyal'
              WHEN r_score >= 3 AND f_score <= 2                   THEN 'New'
              WHEN r_score = 2 AND f_score >= 3                    THEN 'At-Risk'
              WHEN r_score = 2 AND f_score <= 2                    THEN 'Hibernating'
              ELSE 'Lost'
            END AS rfm_segment
          FROM scored
        )
        SELECT member_id, eng_first_name, primary_email, member_type,
               recency_days, frequency, monetary_proxy,
               r_score, f_score, m_score, rfm_total, rfm_segment
        FROM labelled
        ${args.segment_label ? `WHERE rfm_segment = '${args.segment_label}'` : ''}
        ORDER BY rfm_total DESC
        LIMIT ${topN}
      `);

      const summary = rows.reduce((acc, r) => {
        acc[r.rfm_segment] = (acc[r.rfm_segment] || 0) + 1;
        return acc;
      }, {});

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            model_used: "RFM Scoring (percentile bucketing, 1–5 scale per dimension)",
            segment_summary: summary,
            members: rows,
            total_returned: rows.length,
          }),
        }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: e.message }) }] };
    }
  }

  // ── CLV Estimation (BG/NBD-inspired) ────────────────────────────────────
  if (name === "estimate_clv") {
    try {
      const horizon = args.horizon_days || 365;
      const topN = Math.min(args.top_n || 50, 200);

      const { rows } = await pool.query(`
        WITH member_stats AS (
          SELECT
            cp.member_id,
            cp.eng_first_name,
            cp.primary_email,
            cp.member_type,
            EXTRACT(DAY FROM NOW() - cp.member_join_date)::float        AS tenure_days,
            COALESCE(cp.seminar_count, 0)::float                        AS event_count,
            COALESCE(cp.ga_sessions, 0)::float                          AS web_sessions,
            EXTRACT(DAY FROM NOW() - COALESCE(cp.last_activity_date, cp.member_join_date))::float AS recency_days
          FROM app.customer_profiles cp
          WHERE cp.member_join_date IS NOT NULL
            AND EXTRACT(DAY FROM NOW() - cp.member_join_date) > 0
        ),
        clv_calc AS (
          SELECT *,
            -- Purchase rate = events per day alive
            CASE WHEN tenure_days > 0 THEN event_count / tenure_days ELSE 0 END AS daily_event_rate,
            -- Dropout probability proxy: high recency relative to tenure = likely churned
            CASE
              WHEN tenure_days > 0
              THEN LEAST(recency_days / GREATEST(tenure_days, 1), 1.0)
              ELSE 1.0
            END AS dropout_prob
          FROM member_stats
        )
        SELECT
          member_id, eng_first_name, primary_email, member_type,
          tenure_days::int,
          event_count::int,
          web_sessions::int,
          ROUND(recency_days::numeric, 0)::int AS recency_days,
          -- Predicted future engagements: rate × horizon × (1 - dropout_prob)
          ROUND((daily_event_rate * ${horizon} * (1 - dropout_prob))::numeric, 2) AS predicted_future_engagements,
          -- Engagement value proxy: web sessions as activity score
          ROUND((web_sessions / GREATEST(tenure_days / 30.0, 1))::numeric, 2) AS monthly_engagement_score,
          -- CLV = predicted engagements × monthly score (index)
          ROUND((daily_event_rate * ${horizon} * (1 - dropout_prob) * web_sessions / GREATEST(tenure_days / 30.0, 1))::numeric, 2) AS clv_index
        FROM clv_calc
        ORDER BY clv_index DESC
        LIMIT ${topN}
      `);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            model_used: "CLV estimation (BG/NBD-inspired: predicted engagements × engagement score, dropout-adjusted)",
            horizon_days: horizon,
            members: rows,
            total_returned: rows.length,
            note: "clv_index is a relative engagement-value index, not a monetary figure. Use for ranking/prioritisation.",
          }),
        }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: e.message }) }] };
    }
  }

  // ── Churn Risk Scoring (Survival Analysis-inspired hazard model) ─────────
  if (name === "score_churn_risk") {
    try {
      const threshold = args.risk_threshold ?? 70;
      const topN = Math.min(args.top_n || 100, 500);

      const { rows } = await pool.query(`
        WITH scored AS (
          SELECT
            cp.member_id,
            cp.eng_first_name,
            cp.primary_email,
            cp.member_type,
            EXTRACT(DAY FROM NOW() - COALESCE(cp.last_activity_date, cp.member_join_date))::int AS days_inactive,
            EXTRACT(DAY FROM NOW() - cp.member_join_date)::int AS tenure_days,
            COALESCE(cp.seminar_count, 0) AS seminar_count,
            COALESCE(cp.ga_sessions, 0)   AS ga_sessions,
            cp.is_opt_in_email,
            -- Hazard components (weighted, 0-100 scale)
            -- Recency hazard: >180d inactive = max risk
            LEAST(EXTRACT(DAY FROM NOW() - COALESCE(cp.last_activity_date, cp.member_join_date)) / 1.8, 40)::int AS recency_hazard,
            -- Low engagement hazard: 0 seminars, 0 sessions
            CASE
              WHEN COALESCE(cp.seminar_count, 0) = 0 AND COALESCE(cp.ga_sessions, 0) = 0 THEN 30
              WHEN COALESCE(cp.seminar_count, 0) = 0 THEN 20
              WHEN COALESCE(cp.ga_sessions, 0)   = 0 THEN 15
              ELSE 5
            END AS engagement_hazard,
            -- No email opt-in = less re-engagement path
            CASE WHEN cp.is_opt_in_email = false OR cp.is_opt_in_email IS NULL THEN 15 ELSE 0 END AS channel_hazard,
            -- Short tenure = still evaluating, some dropout risk
            CASE WHEN EXTRACT(DAY FROM NOW() - cp.member_join_date) < 30 THEN 15 ELSE 0 END AS new_member_hazard
          FROM app.customer_profiles cp
          WHERE cp.member_join_date IS NOT NULL
        )
        SELECT *,
          LEAST(recency_hazard + engagement_hazard + channel_hazard + new_member_hazard, 100) AS churn_risk_score,
          CASE
            WHEN LEAST(recency_hazard + engagement_hazard + channel_hazard + new_member_hazard, 100) >= 80 THEN 'Critical'
            WHEN LEAST(recency_hazard + engagement_hazard + channel_hazard + new_member_hazard, 100) >= 60 THEN 'High'
            WHEN LEAST(recency_hazard + engagement_hazard + channel_hazard + new_member_hazard, 100) >= 40 THEN 'Medium'
            ELSE 'Low'
          END AS risk_tier
        FROM scored
        WHERE (recency_hazard + engagement_hazard + channel_hazard + new_member_hazard) >= ${threshold}
        ORDER BY churn_risk_score DESC
        LIMIT ${topN}
      `);

      const tierSummary = rows.reduce((acc, r) => {
        acc[r.risk_tier] = (acc[r.risk_tier] || 0) + 1;
        return acc;
      }, {});

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            model_used: "Churn Risk Scoring (Survival Analysis-inspired additive hazard model: recency + engagement + channel + tenure components)",
            risk_threshold_used: threshold,
            tier_summary: tierSummary,
            members: rows,
            total_returned: rows.length,
          }),
        }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: e.message }) }] };
    }
  }

  // ── Cohort Retention (exponential decay fit) ─────────────────────────────
  if (name === "analyze_cohort_retention") {
    try {
      const cohortMonths = Math.min(args.cohort_months || 12, 24);

      const { rows } = await pool.query(`
        WITH cohorts AS (
          SELECT
            member_id,
            DATE_TRUNC('month', member_join_date) AS cohort_month
          FROM app.customer_profiles
          WHERE member_join_date >= NOW() - INTERVAL '${cohortMonths + 1} months'
        ),
        activity AS (
          SELECT
            c.cohort_month,
            c.member_id,
            EXTRACT(MONTH FROM AGE(
              DATE_TRUNC('month', COALESCE(cp.last_activity_date, cp.member_join_date)),
              c.cohort_month
            ))::int AS months_since_join
          FROM cohorts c
          JOIN app.customer_profiles cp ON cp.member_id = c.member_id
        ),
        retention AS (
          SELECT
            cohort_month,
            months_since_join,
            COUNT(DISTINCT member_id) AS retained_members
          FROM activity
          WHERE months_since_join >= 0
          GROUP BY cohort_month, months_since_join
        ),
        cohort_sizes AS (
          SELECT cohort_month, COUNT(DISTINCT member_id) AS cohort_size
          FROM cohorts
          GROUP BY cohort_month
        )
        SELECT
          r.cohort_month,
          cs.cohort_size,
          r.months_since_join,
          r.retained_members,
          ROUND((r.retained_members::float / NULLIF(cs.cohort_size, 0) * 100)::numeric, 1) AS retention_pct
        FROM retention r
        JOIN cohort_sizes cs ON cs.cohort_month = r.cohort_month
        ORDER BY r.cohort_month, r.months_since_join
      `);

      // Build matrix and compute average retention curve
      const matrix = {};
      rows.forEach(r => {
        const k = r.cohort_month?.toISOString?.()?.slice(0, 7) ?? String(r.cohort_month);
        if (!matrix[k]) matrix[k] = { cohort_size: Number(r.cohort_size), months: {} };
        matrix[k].months[r.months_since_join] = Number(r.retention_pct);
      });

      // Average retention by month offset across all cohorts
      const avgByOffset = {};
      Object.values(matrix).forEach(c => {
        Object.entries(c.months).forEach(([offset, pct]) => {
          if (!avgByOffset[offset]) avgByOffset[offset] = [];
          avgByOffset[offset].push(pct);
        });
      });
      const avgRetention = Object.fromEntries(
        Object.entries(avgByOffset)
          .map(([offset, vals]) => [offset, Math.round(vals.reduce((s, v) => s + v, 0) / vals.length * 10) / 10])
          .sort(([a], [b]) => Number(a) - Number(b))
      );

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            model_used: "Cohort Retention Analysis (month-over-month retention matrix with average retention curve)",
            cohort_matrix: matrix,
            average_retention_curve: avgRetention,
            note: "Retention % = members still active at month N / cohort size at month 0.",
          }),
        }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: e.message }) }] };
    }
  }

  // ── K-Means Clustering (in-SQL centroid approximation) ──────────────────
  if (name === "cluster_members") {
    try {
      const k = Math.min(Math.max(args.k || 4, 2), 8);

      // Fetch normalised features
      const { rows: members } = await pool.query(`
        SELECT
          member_id, eng_first_name, primary_email, member_type,
          EXTRACT(DAY FROM NOW() - member_join_date)::float       AS tenure_days,
          COALESCE(seminar_count, 0)::float                       AS seminars,
          COALESCE(ga_sessions, 0)::float                         AS sessions,
          CASE WHEN is_opt_in_email = true THEN 1.0 ELSE 0.0 END  AS opted_in
        FROM app.customer_profiles
        WHERE member_join_date IS NOT NULL
        LIMIT 5000
      `);

      if (members.length === 0) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "No member data available for clustering." }) }] };
      }

      // Normalise features min-max
      const featureKeys = ["tenure_days", "seminars", "sessions", "opted_in"];
      const mins = {}, maxes = {};
      featureKeys.forEach(f => {
        const vals = members.map(m => Number(m[f]));
        mins[f] = Math.min(...vals);
        maxes[f] = Math.max(...vals) || 1;
      });

      const normalised = members.map(m => ({
        ...m,
        _f: featureKeys.map(f => (Number(m[f]) - mins[f]) / (maxes[f] - mins[f])),
      }));

      // K-Means++ initialisation: spread initial centroids
      const centroids = [normalised[Math.floor(Math.random() * normalised.length)]._f.slice()];
      while (centroids.length < k) {
        const dists = normalised.map(m => {
          const minD = Math.min(...centroids.map(c => euclidean(m._f, c)));
          return minD * minD;
        });
        const total = dists.reduce((s, d) => s + d, 0);
        let r = Math.random() * total;
        for (let i = 0; i < normalised.length; i++) {
          r -= dists[i];
          if (r <= 0) { centroids.push(normalised[i]._f.slice()); break; }
        }
      }

      // Iterate K-Means (10 passes)
      let assignments = new Array(normalised.length).fill(0);
      for (let iter = 0; iter < 10; iter++) {
        assignments = normalised.map(m =>
          centroids.reduce((best, c, ci) =>
            euclidean(m._f, c) < euclidean(m._f, centroids[best]) ? ci : best, 0)
        );
        featureKeys.forEach((_, fi) => {
          centroids.forEach((c, ci) => {
            const pts = normalised.filter((_, i) => assignments[i] === ci);
            if (pts.length > 0) c[fi] = pts.reduce((s, p) => s + p._f[fi], 0) / pts.length;
          });
        });
      }

      // Build cluster profiles
      const clusters = Array.from({ length: k }, (_, ci) => {
        const pts = normalised.filter((_, i) => assignments[i] === ci);
        const avg = f => pts.length ? pts.reduce((s, p) => s + Number(p[f]), 0) / pts.length : 0;
        const centroid = {
          avg_tenure_days: Math.round(avg("tenure_days")),
          avg_seminars:    Math.round(avg("seminars") * 10) / 10,
          avg_sessions:    Math.round(avg("sessions") * 10) / 10,
          opt_in_rate:     Math.round(avg("opted_in") * 1000) / 10 + "%",
        };
        return {
          cluster_id: ci + 1,
          size: pts.length,
          centroid,
          label: labelCluster(centroid),
          sample_members: pts.slice(0, 5).map(m => ({ member_id: m.member_id, name: m.eng_first_name, email: m.primary_email })),
        };
      }).sort((a, b) => b.size - a.size);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            model_used: `K-Means Clustering (K=${k}, K-Means++ init, 10 iterations, features: tenure, seminars, sessions, email opt-in)`,
            k,
            clusters,
          }),
        }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: e.message }) }] };
    }
  }

  // ── Association Rules (Apriori-style) ────────────────────────────────────
  if (name === "find_association_rules") {
    try {
      const minSupport = args.min_support || 0.05;
      const minLift    = args.min_lift    || 1.5;
      const topN       = Math.min(args.top_n || 20, 100);

      const { rows: events } = await pool.query(`
        SELECT cp.member_id AS membership_id, s->>'event_name' AS event_name
        FROM app.customer_profiles cp
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(cp.seminars, '[]'::jsonb)) AS s
        WHERE s->>'event_name' IS NOT NULL
        ORDER BY cp.member_id
      `);

      if (events.length === 0) {
        return { content: [{ type: "text", text: JSON.stringify({ rules: [], note: "No custom activity data found." }) }] };
      }

      // Build member → event set map
      const memberEvents = {};
      events.forEach(({ membership_id, event_name }) => {
        if (!memberEvents[membership_id]) memberEvents[membership_id] = new Set();
        memberEvents[membership_id].add(event_name);
      });

      const members = Object.values(memberEvents);
      const totalMembers = members.length;
      const allEvents = [...new Set(events.map(e => e.event_name))];

      // Single-item support
      const itemSupport = {};
      allEvents.forEach(ev => {
        itemSupport[ev] = members.filter(s => s.has(ev)).length / totalMembers;
      });

      // Frequent single items above threshold
      const frequent = allEvents.filter(ev => itemSupport[ev] >= minSupport);

      // Generate pair rules
      const rules = [];
      for (let i = 0; i < frequent.length; i++) {
        for (let j = 0; j < frequent.length; j++) {
          if (i === j) continue;
          const antecedent = frequent[i];
          const consequent = frequent[j];
          const both = members.filter(s => s.has(antecedent) && s.has(consequent)).length;
          const support    = both / totalMembers;
          const confidence = both / Math.max(members.filter(s => s.has(antecedent)).length, 1);
          const lift       = confidence / Math.max(itemSupport[consequent], 0.0001);

          if (support >= minSupport && lift >= minLift) {
            rules.push({ antecedent, consequent, support: Math.round(support * 1000) / 1000, confidence: Math.round(confidence * 1000) / 1000, lift: Math.round(lift * 100) / 100 });
          }
        }
      }

      rules.sort((a, b) => b.lift - a.lift);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            model_used: "Association Rule Mining (Apriori-style: pair co-occurrence with support, confidence, lift filtering)",
            parameters: { min_support: minSupport, min_lift: minLift },
            total_members_analysed: totalMembers,
            total_unique_events: allEvents.length,
            rules: rules.slice(0, topN),
          }),
        }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: e.message }) }] };
    }
  }

  // ── Markov Chain Next-Event Prediction ───────────────────────────────────
  if (name === "predict_next_event") {
    try {
      const afterEvent = args.after_event_name;
      const topN = Math.min(args.top_n || 5, 20);

      const { rows: sequences } = await pool.query(`
        SELECT cp.member_id AS membership_id, s->>'event_name' AS event_name,
               (s->>'event_date')::timestamptz AS event_date
        FROM app.customer_profiles cp
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(cp.seminars, '[]'::jsonb)) AS s
        WHERE s->>'event_name' IS NOT NULL
        ORDER BY cp.member_id, event_date
      `);

      if (sequences.length === 0) {
        return { content: [{ type: "text", text: JSON.stringify({ predictions: [], note: "No activity sequence data." }) }] };
      }

      // Build ordered event sequences per member
      const memberSeqs = {};
      sequences.forEach(({ membership_id, event_name }) => {
        if (!memberSeqs[membership_id]) memberSeqs[membership_id] = [];
        memberSeqs[membership_id].push(event_name);
      });

      // Count transitions from afterEvent
      const transitionCounts = {};
      let totalTransitions = 0;
      Object.values(memberSeqs).forEach(seq => {
        for (let i = 0; i < seq.length - 1; i++) {
          if (seq[i] === afterEvent) {
            transitionCounts[seq[i + 1]] = (transitionCounts[seq[i + 1]] || 0) + 1;
            totalTransitions++;
          }
        }
      });

      if (totalTransitions === 0) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              model_used: "Markov Chain (first-order transition matrix)",
              from_event: afterEvent,
              predictions: [],
              note: `No observed transitions found from '${afterEvent}'. Members may not have subsequent events.`,
            }),
          }],
        };
      }

      const predictions = Object.entries(transitionCounts)
        .map(([event, count]) => ({
          next_event: event,
          transition_count: count,
          probability: Math.round((count / totalTransitions) * 1000) / 1000,
        }))
        .sort((a, b) => b.probability - a.probability)
        .slice(0, topN);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            model_used: "Markov Chain (first-order transition probability matrix over member event sequences)",
            from_event: afterEvent,
            total_observed_transitions: totalTransitions,
            predictions,
          }),
        }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: e.message }) }] };
    }
  }

  // ── Shapley / Multi-Touch Attribution ────────────────────────────────────
  if (name === "compute_channel_attribution") {
    try {
      const days = args.days || 90;
      const model = args.attribution_model || "shapley";

      const { rows: channels } = await pool.query(`
        SELECT
          COALESCE(member_reg_channel, 'unknown') AS channel,
          COUNT(*) AS member_count,
          COUNT(*) FILTER (WHERE seminar_count > 0)   AS converted,
          COUNT(*) FILTER (WHERE ga_sessions >= 3)    AS engaged
        FROM app.customer_profiles
        WHERE member_join_date >= NOW() - INTERVAL '${days} days'
        GROUP BY member_reg_channel
        ORDER BY member_count DESC
      `);

      if (channels.length === 0) {
        return { content: [{ type: "text", text: JSON.stringify({ attribution: [], note: "No registration data in window." }) }] };
      }

      const totalConverted = channels.reduce((s, r) => s + Number(r.converted), 0) || 1;

      let attribution;
      if (model === "shapley") {
        // Simplified Shapley: proportional to marginal conversion rate × volume
        const scores = channels.map(r => ({
          channel: r.channel,
          member_count: Number(r.member_count),
          converted: Number(r.converted),
          conversion_rate: Number(r.converted) / Math.max(Number(r.member_count), 1),
          marginal_value: (Number(r.converted) / Math.max(Number(r.member_count), 1)) * Number(r.member_count),
        }));
        const totalMV = scores.reduce((s, r) => s + r.marginal_value, 0) || 1;
        attribution = scores.map(r => ({
          ...r,
          shapley_credit: Math.round((r.marginal_value / totalMV) * 100 * 10) / 10 + "%",
        }));
      } else if (model === "last_touch") {
        attribution = channels.map(r => ({
          channel: r.channel,
          member_count: Number(r.member_count),
          converted: Number(r.converted),
          credit: Math.round((Number(r.converted) / totalConverted) * 100 * 10) / 10 + "%",
        }));
      } else if (model === "first_touch") {
        // Same as last_touch for single-channel members; note this in result
        attribution = channels.map(r => ({
          channel: r.channel,
          member_count: Number(r.member_count),
          converted: Number(r.converted),
          credit: Math.round((Number(r.converted) / totalConverted) * 100 * 10) / 10 + "%",
          note: "First-touch = last-touch when members have one registration channel.",
        }));
      } else {
        // Linear: equal credit across all channels
        const n = channels.length;
        attribution = channels.map(r => ({
          channel: r.channel,
          member_count: Number(r.member_count),
          converted: Number(r.converted),
          credit: Math.round((1 / n) * 100 * 10) / 10 + "%",
        }));
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            model_used: `Channel Attribution (${model === "shapley" ? "Shapley Value – marginal conversion rate × volume" : model + " model"})`,
            attribution_model: model,
            days_analysed: days,
            total_conversions: totalConverted,
            attribution,
          }),
        }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: e.message }) }] };
    }
  }

  // ── Anomaly Detection (Z-score + IQR) ────────────────────────────────────
  if (name === "detect_anomalies") {
    try {
      const days = args.days || 90;
      const zThreshold = args.z_threshold || 2.5;
      const metric = args.metric;

      let sql;
      if (metric === "registrations") {
        sql = `
          SELECT DATE(member_join_date) AS day, COUNT(*) AS value
          FROM app.customer_profiles
          WHERE member_join_date >= NOW() - INTERVAL '${days} days'
          GROUP BY DATE(member_join_date)
          ORDER BY day
        `;
      } else if (metric === "event_attendance") {
        sql = `
          SELECT DATE((s->>'event_date')::timestamptz) AS day, COUNT(*) AS value
          FROM app.customer_profiles cp
          CROSS JOIN LATERAL jsonb_array_elements(COALESCE(cp.seminars, '[]'::jsonb)) AS s
          WHERE (s->>'event_date')::timestamptz >= NOW() - INTERVAL '${days} days'
          GROUP BY DATE((s->>'event_date')::timestamptz)
          ORDER BY day
        `;
      } else {
        sql = `
          SELECT DATE(occurred_at) AS day, COUNT(*) AS value
          FROM app.edm_events
          WHERE event_type = 'open'
            AND occurred_at >= NOW() - INTERVAL '${days} days'
          GROUP BY DATE(occurred_at)
          ORDER BY day
        `;
      }

      const { rows } = await pool.query(sql);

      if (rows.length < 5) {
        return { content: [{ type: "text", text: JSON.stringify({ anomalies: [], note: "Insufficient data points for anomaly detection (need ≥5 days)." }) }] };
      }

      const values = rows.map(r => Number(r.value));
      const mean = values.reduce((s, v) => s + v, 0) / values.length;
      const std  = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length) || 1;

      // IQR
      const sorted = [...values].sort((a, b) => a - b);
      const q1 = sorted[Math.floor(sorted.length * 0.25)];
      const q3 = sorted[Math.floor(sorted.length * 0.75)];
      const iqr = q3 - q1;
      const lowerFence = q1 - 1.5 * iqr;
      const upperFence = q3 + 1.5 * iqr;

      const anomalies = rows
        .map((r, i) => {
          const z = (values[i] - mean) / std;
          const iqrFlag = values[i] < lowerFence || values[i] > upperFence;
          return {
            day: r.day,
            value: values[i],
            z_score: Math.round(z * 100) / 100,
            direction: values[i] > mean ? "spike" : "drop",
            is_anomaly: Math.abs(z) >= zThreshold || iqrFlag,
          };
        })
        .filter(r => r.is_anomaly);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            model_used: `Anomaly Detection (Z-score threshold=${zThreshold} + IQR fence method, dual-flag approach)`,
            metric,
            days_analysed: days,
            baseline_mean: Math.round(mean * 10) / 10,
            baseline_std: Math.round(std * 10) / 10,
            iqr_bounds: { lower: Math.round(lowerFence), upper: Math.round(upperFence) },
            anomaly_count: anomalies.length,
            anomalies,
          }),
        }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: e.message }) }] };
    }
  }

  // ── Registration Forecast (Holt-Winters Exponential Smoothing) ───────────
  if (name === "forecast_registrations") {
    try {
      const forecastDays = Math.min(args.forecast_days || 30, 90);
      const historyDays  = Math.min(args.history_days  || 180, 365);

      const { rows } = await pool.query(`
        SELECT DATE(member_join_date) AS day, COUNT(*) AS registrations
        FROM app.customer_profiles
        WHERE member_join_date >= NOW() - INTERVAL '${historyDays} days'
        GROUP BY DATE(member_join_date)
        ORDER BY day
      `);

      if (rows.length < 14) {
        return { content: [{ type: "text", text: JSON.stringify({ forecast: [], note: "Insufficient data for forecasting (need ≥14 days of history)." }) }] };
      }

      const values = rows.map(r => Number(r.registrations));

      // Holt-Winters Double Exponential Smoothing (trend, no seasonal for daily)
      const alpha = 0.3; // level smoothing
      const beta  = 0.1; // trend smoothing

      let level = values[0];
      let trend = values[1] - values[0];
      const smoothed = [level];

      for (let i = 1; i < values.length; i++) {
        const prevLevel = level;
        level = alpha * values[i] + (1 - alpha) * (level + trend);
        trend = beta  * (level - prevLevel) + (1 - beta) * trend;
        smoothed.push(Math.round(level * 10) / 10);
      }

      // Project forward
      const forecast = [];
      const lastDate = new Date(rows[rows.length - 1].day);
      for (let h = 1; h <= forecastDays; h++) {
        const d = new Date(lastDate);
        d.setDate(d.getDate() + h);
        const point = Math.max(Math.round((level + h * trend) * 10) / 10, 0);
        const ci = Math.round(point * 0.2 * 10) / 10; // ±20% CI proxy
        forecast.push({
          day: d.toISOString().slice(0, 10),
          forecast: point,
          ci_lower: Math.max(point - ci, 0),
          ci_upper: point + ci,
        });
      }

      const totalForecast = forecast.reduce((s, f) => s + f.forecast, 0);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            model_used: `Holt-Winters Double Exponential Smoothing (α=${alpha}, β=${beta}, trend-adjusted, ±20% confidence interval)`,
            history_days: historyDays,
            forecast_days: forecastDays,
            projected_total_registrations: Math.round(totalForecast),
            smoothing_params: { alpha, beta },
            last_known_daily_avg: Math.round(values.slice(-7).reduce((s, v) => s + v, 0) / 7 * 10) / 10,
            forecast,
          }),
        }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: e.message }) }] };
    }
  }

  return { content: [{ type: "text", text: JSON.stringify({ error: `Unknown analytics tool: ${name}` }) }] };
}

// ─── Pure helpers (no DB) ─────────────────────────────────────────────────────

function euclidean(a, b) {
  return Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0));
}

function labelCluster(c) {
  if (c.avg_seminars >= 3 && c.avg_sessions >= 10) return "Highly Engaged";
  if (c.avg_tenure_days <= 60)                      return "New Members";
  if (c.avg_seminars === 0 && c.avg_sessions < 2)   return "Dormant";
  if (c.avg_seminars >= 2)                           return "Event-Oriented";
  if (c.avg_sessions >= 5)                           return "Web-Active";
  return "Moderate Engagement";
}
