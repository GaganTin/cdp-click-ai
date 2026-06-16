const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";

// Injected by AuthContext after company selection
let _currentCompanyId = null;
export function setCurrentCompanyId(id) { _currentCompanyId = id; }
export function getCurrentCompanyId() { return _currentCompanyId; }

async function request(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (_currentCompanyId) {
    headers["x-company-id"] = _currentCompanyId;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers,
  });

  if (!res.ok) {
    let payload = null;
    try {
      payload = await res.json();
    } catch {
      payload = { error: res.statusText };
    }
    const err = new Error(payload.error || `Request failed: ${res.status}`);
    err.status = res.status;
    err.payload = payload; // structured fields (e.g. conflicts) survive for callers
    throw err;
  }

  return res.json();
}

function buildEntityApi(entityName) {
  return {
    async list(sort, limit) {
      const params = new URLSearchParams();
      if (sort) params.set("sort", sort);
      if (limit) params.set("limit", String(limit));
      const q = params.toString();
      return request(`/entities/${entityName}${q ? `?${q}` : ""}`);
    },
    async create(data) {
      return request(`/entities/${entityName}`, {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    async update(id, data) {
      return request(`/entities/${entityName}/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
    },
    async delete(id) {
      return request(`/entities/${entityName}/${id}`, {
        method: "DELETE",
      });
    },
  };
}

export const appClient = {
  auth: {
    me: () => request("/auth/me"),
    login: (email, password) =>
      request("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
    register: (data) =>
      request("/auth/register", { method: "POST", body: JSON.stringify(data) }),
    // Code-based sign-up: start (email a code) → verify (create account) → resend.
    registerStart: (data) =>
      request("/auth/register/start", { method: "POST", body: JSON.stringify(data) }),
    registerVerify: (email, code) =>
      request("/auth/register/verify", { method: "POST", body: JSON.stringify({ email, code }) }),
    registerResend: (email) =>
      request("/auth/register/resend", { method: "POST", body: JSON.stringify({ email }) }),
    logout: async () => {
      try { await request("/auth/logout", { method: "POST" }); } catch { /* ignore */ }
      window.location.href = "/";
    },
    updateProfile: (data) =>
      request("/auth/me", { method: "PATCH", body: JSON.stringify(data) }),
    changePassword: (current_password, new_password) =>
      request("/auth/me/password", { method: "PATCH", body: JSON.stringify({ current_password, new_password }) }),
    forgotPassword: (email) =>
      request("/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) }),
    resendVerification: () =>
      request("/auth/resend-verification", { method: "POST" }),
    resetPassword: (token, new_password) =>
      request("/auth/reset-password", { method: "POST", body: JSON.stringify({ token, new_password }) }),
    redirectToLogin: () => { window.location.href = "/login"; },
    getPreferences: () => request("/auth/preferences"),
    updatePreferences: (data) => request("/auth/preferences", { method: "PATCH", body: JSON.stringify(data) }),
  },
  companies: {
    create: (data) =>
      request("/companies", { method: "POST", body: JSON.stringify(data) }),
    get: (id) => request(`/companies/${id}`),
    update: (id, data) =>
      request(`/companies/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    getMembers: (id) => request(`/companies/${id}/members`),
    updateMember: (companyId, memberId, data) =>
      request(`/companies/${companyId}/members/${memberId}`, { method: "PATCH", body: JSON.stringify(data) }),
    removeMember: (companyId, memberId) =>
      request(`/companies/${companyId}/members/${memberId}`, { method: "DELETE" }),
    getInvitations: (id) => request(`/companies/${id}/invitations`),
    invite: (id, email, role) =>
      request(`/companies/${id}/invitations`, { method: "POST", body: JSON.stringify({ email, role }) }),
    cancelInvitation: (companyId, invId) =>
      request(`/companies/${companyId}/invitations/${invId}`, { method: "DELETE" }),
    acceptInvitation: (token) =>
      request(`/companies/join/${token}`, { method: "POST" }),
    getPreferences: (id) => request(`/companies/${id}/preferences`),
    updatePreferences: (id, data) =>
      request(`/companies/${id}/preferences`, { method: "PATCH", body: JSON.stringify(data) }),
    getApiKeys: (id) => request(`/companies/${id}/api-keys`),
    createApiKey: (id, data) =>
      request(`/companies/${id}/api-keys`, { method: "POST", body: JSON.stringify(data) }),
    revokeApiKey: (companyId, keyId) =>
      request(`/companies/${companyId}/api-keys/${keyId}`, { method: "DELETE" }),
    getAuditLog: (id, limit) => {
      const q = limit ? `?limit=${limit}` : "";
      return request(`/companies/${id}/audit-log${q}`);
    },
  },
  plans: {
    list: () => fetch("/api/plans").then(r => r.json()),
    update: (id, data) => request(`/plans/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  },
  billing: {
    getUsage:   () => request("/billing/usage"),
  },
  // Platform-owner ("Studio") API - platform-scoped, no x-company-id needed.
  admin: {
    getStats:      () => request("/admin/stats"),
    listAccounts:  (params = {}) => {
      const q = new URLSearchParams(
        Object.entries(params).filter(([, v]) => v != null && v !== "")
      ).toString();
      return request(`/admin/accounts${q ? `?${q}` : ""}`);
    },
    getAccount:    (id) => request(`/admin/accounts/${id}`),
    updateAccount: (id, data) => request(`/admin/accounts/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    deleteAccount: (id) => request(`/admin/accounts/${id}`, { method: "DELETE" }),
    listUsers:     (search) => request(`/admin/users${search ? `?search=${encodeURIComponent(search)}` : ""}`),
    updateUser:    (id, data) => request(`/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    sendVerification: (id) => request(`/admin/users/${id}/send-verification`, { method: "POST" }),
    sendReset:     (id) => request(`/admin/users/${id}/send-reset`, { method: "POST" }),
    impersonate:   (id) => request(`/admin/users/${id}/impersonate`, { method: "POST" }),
    inviteOwner:   (email) => request("/admin/owners/invite", { method: "POST", body: JSON.stringify({ email }) }),
    listOwnerInvites: () => request("/admin/owner-invites"),
    cancelOwnerInvite: (email) => request(`/admin/owner-invites/${encodeURIComponent(email)}`, { method: "DELETE" }),
    listAudit:     (params = {}) => {
      const q = new URLSearchParams(
        Object.entries(params).filter(([, v]) => v != null && v !== "")
      ).toString();
      return request(`/admin/audit${q ? `?${q}` : ""}`);
    },
    listTickets:   (params = {}) => {
      const q = new URLSearchParams(
        Object.entries(params).filter(([, v]) => v != null && v !== "")
      ).toString();
      return request(`/admin/tickets${q ? `?${q}` : ""}`);
    },
    updateTicket:  (id, data) => request(`/admin/tickets/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    listPlans:     () => request("/admin/plans"),
    updatePlan:    (id, data) => request(`/admin/plans/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  },
  support: {
    listTickets:  () => request("/support/tickets"),
    createTicket: (data) => request("/support/tickets", { method: "POST", body: JSON.stringify(data) }),
  },
  notifications: {
    list: ({ limit = 20, unread = false } = {}) => {
      const params = new URLSearchParams();
      params.set("limit", String(limit));
      if (unread) params.set("unread", "true");
      return request(`/notifications?${params.toString()}`);
    },
    markRead:    (id) => request(`/notifications/${id}/read`, { method: "POST" }),
    markAllRead: () => request("/notifications/read-all", { method: "POST" }),
    remove:      (id) => request(`/notifications/${id}`, { method: "DELETE" }),
    clearAll:    () => request("/notifications", { method: "DELETE" }),
  },
  segments: {
    // Live member count for a segment (matches its filter criteria).
    size: (id) => request(`/segments/${encodeURIComponent(id)}/size`),
    // Download a segment's matching profiles + criteria as a CSV file.
    async exportCsv(id, name) {
      const headers = {};
      if (_currentCompanyId) headers["x-company-id"] = _currentCompanyId;
      const res = await fetch(`${API_BASE}/segments/${encodeURIComponent(id)}/export`, {
        credentials: "include", headers,
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || "Export failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const safe = (name || "segment").replace(/[^a-z0-9\-_]+/gi, "_").toLowerCase();
      a.href = url; a.download = `segment_${safe}.csv`;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
    },
  },
  entities: {
    Campaign: buildEntityApi("Campaign"),
    Segment: buildEntityApi("Segment"),
    SavedReport: buildEntityApi("SavedReport"),
    PinnedChart: buildEntityApi("PinnedChart"),
    DataDictionary: buildEntityApi("DataDictionary"),
  },
  agents: {
    async createConversation(payload) {
      return request("/agents/conversations", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    async getConversation(id) {
      return request(`/agents/conversations/${id}`);
    },
    async updateConversation(id, payload) {
      return request(`/agents/conversations/${id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
    },
    async listConversations(filters = {}) {
      const params = new URLSearchParams();
      if (filters.agent_name) params.set("agent_name", filters.agent_name);
      const q = params.toString();
      return request(`/agents/conversations${q ? `?${q}` : ""}`);
    },
    async addMessage(conversation, payload) {
      const id = typeof conversation === "string" ? conversation : conversation?.id;
      return request(`/agents/conversations/${id}/messages`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    subscribeToConversation(conversationId, callback, intervalMs = 1500) {
      let cancelled = false;
      const pull = async () => {
        if (cancelled) return;
        try {
          const conv = await request(`/agents/conversations/${conversationId}`);
          callback(conv);
        } catch { /* silent */ }
      };
      pull();
      const timer = window.setInterval(pull, intervalMs);
      return () => { cancelled = true; window.clearInterval(timer); };
    },
  },
  skills: {
    async list() {
      return request("/skills");
    },
    async create(payload) {
      return request("/skills", { method: "POST", body: JSON.stringify(payload) });
    },
    async update(id, payload) {
      return request(`/skills/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
    },
    async remove(id) {
      return request(`/skills/${id}`, { method: "DELETE" });
    },
  },
  functions: {
    async invoke(name, payload) {
      return request(`/functions/${name}`, {
        method: "POST",
        body: JSON.stringify(payload || {}),
      });
    },
  },
  // Company-scoped UTM analytics (server-side aggregation; see server/routes/utm.js)
  utm: {
    _qs(params = {}) {
      const q = new URLSearchParams(
        Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ""))
      ).toString();
      return q ? `?${q}` : "";
    },
    kpis(params)        { return request(`/utm/kpis${this._qs(params)}`); },
    breakdown(params)   { return request(`/utm/breakdown${this._qs(params)}`); },
    timeseries(params)  { return request(`/utm/timeseries${this._qs(params)}`); },
    countries(params)   { return request(`/utm/countries${this._qs(params)}`); },
    utmIds(params)      { return request(`/utm/utm-ids${this._qs(params)}`); },
    paramValues(params) { return request(`/utm/param-values${this._qs(params)}`); },
    links(days = 30)    { return request(`/utm/links?days=${days}`); },
    campaignPerformance(names, days = 30) {
      return request(`/utm/campaign-performance`, { method: "POST", body: JSON.stringify({ names, days }) });
    },
    exists(source, medium, campaign) {
      return request(`/utm/exists${this._qs({ source, medium, campaign })}`);
    },
  },
  profiles: {
    async listCustomers(params = {}) {
      const q = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ""))).toString();
      return request(`/profiles/customers${q ? `?${q}` : ""}`);
    },
    async customerFilters() { return request("/profiles/customer-filters"); },
    async listAnonymous(params = {}) {
      const q = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ""))).toString();
      return request(`/profiles/anonymous${q ? `?${q}` : ""}`);
    },
    async anonymousFilters() { return request("/profiles/anonymous-filters"); },
    async refresh() { return request("/profiles/refresh", { method: "POST" }); },
    downloadTemplate() {
      const headers = [
        "member_id", "primary_email", "primary_phone",
        "eng_full_name", "eng_first_name", "eng_last_name", "display_name",
        "member_no", "title", "member_type", "member_join_date",
        "member_reg_channel",
        "gender", "age_group", "nationality",
        "education_level", "income_level", "employment_status", "marital_status",
        "preferred_language", "preferred_channel",
        "is_opt_in_email", "is_opt_in_sms", "is_opt_in_call", "is_opt_in_dm",
        "tags",
      ];
      const sample = [
        "", "john.doe@example.com", "+1234567890",
        "John Doe", "John", "Doe", "",
        "MEM001", "Mr", "Regular", "2024-01-15",
        "Manual Import",
        "M", "25-34", "Australian",
        "Bachelor's Degree", "50000-75000", "Employed", "Single",
        "English", "Email",
        "true", "false", "false", "false",
        "",
      ];
      const csv = [
        headers.join(","),
        sample.map(v => (v.includes(",") ? `"${v}"` : v)).join(","),
      ].join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "customer_profiles_template.csv";
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
    },
    async importProfiles(file) {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${API_BASE}/profiles/import`, {
        method: "POST", body: fd, credentials: "include",
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || "Import failed");
      }
      return res.json();
    },
    async deleteProfile(memberId) {
      return request(`/profiles/customers/${encodeURIComponent(memberId)}`, { method: "DELETE" });
    },
    async transactions(memberId) {
      return request(`/profiles/customers/${encodeURIComponent(memberId)}/transactions`);
    },
    async insights(memberId) {
      return request(`/profiles/customers/${encodeURIComponent(memberId)}/insights`);
    },
    async anonymousInsights(visitorId) {
      return request(`/profiles/anonymous/${encodeURIComponent(visitorId)}/insights`);
    },
    async analytics(params = {}) {
      const q = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ""))).toString();
      return request(`/profiles/analytics${q ? `?${q}` : ""}`);
    },
  },
  edm: {
    listCampaigns: () => request("/edm/campaigns"),
    createCampaign: (data) => request("/edm/campaigns", { method: "POST", body: JSON.stringify(data) }),
    getCampaign: (id) => request(`/edm/campaigns/${id}`),
    updateCampaign: (id, data) => request(`/edm/campaigns/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    deleteCampaign: (id) => request(`/edm/campaigns/${id}`, { method: "DELETE" }),
    sendCampaign: (id) => request(`/edm/campaigns/${id}/send`, { method: "POST" }),
    cancelCampaign: (id) => request(`/edm/campaigns/${id}/cancel`, { method: "POST" }),
    archiveCampaign: (id) => request(`/edm/campaigns/${id}/archive`, { method: "POST" }),
    getCampaignStats: (id) => request(`/edm/campaigns/${id}/stats`),
    getCampaignSends: (id) => request(`/edm/campaigns/${id}/sends`),
    getRecipientsPreview: (id) => request(`/edm/campaigns/${id}/recipients/preview`),
    previewRecipientsBySegment: () => request("/edm/recipients/preview"),
    testSend: (payload) => request("/edm/test-send", { method: "POST", body: JSON.stringify(payload) }),
    listTemplates: () => request("/edm/templates"),
    createTemplate: (data) => request("/edm/templates", { method: "POST", body: JSON.stringify(data) }),
    updateTemplate: (id, data) => request(`/edm/templates/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    deleteTemplate: (id) => request(`/edm/templates/${id}`, { method: "DELETE" }),
    duplicateTemplate: (id) => request(`/edm/templates/${id}/duplicate`, { method: "POST" }),
    listSuppression: () => request("/edm/suppression"),
    addSuppression: (email, reason = "manual") => request("/edm/suppression", { method: "POST", body: JSON.stringify({ email, reason }) }),
    importSuppression: (entries) => request("/edm/suppression/bulk", { method: "POST", body: JSON.stringify({ entries }) }),
    removeSuppression: (email) => request(`/edm/suppression/${encodeURIComponent(email)}`, { method: "DELETE" }),
    bulkRemoveSuppression: (emails) => request("/edm/suppression", { method: "DELETE", body: JSON.stringify({ emails }) }),
    getSettings: () => request("/edm/settings"),
    listAutomations: () => request("/edm/automations"),
    createAutomation: (data) => request("/edm/automations", { method: "POST", body: JSON.stringify(data) }),
    updateAutomation: (id, data) => request(`/edm/automations/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    deleteAutomation: (id) => request(`/edm/automations/${id}`, { method: "DELETE" }),
  },
  dataIntegrations: {
    list:       ()            => request("/data-integrations"),
    get:        (type)        => request(`/data-integrations/${type}`),
    connect:    (type, config) => request(`/data-integrations/${type}/connect`, { method: "POST", body: JSON.stringify(config) }),
    check:      (type)        => request(`/data-integrations/${type}/check`,   { method: "POST" }),
    sync:       (type)        => request(`/data-integrations/${type}/sync`,    { method: "POST" }),
    cancelSync: (type)        => request(`/data-integrations/${type}/sync/cancel`, { method: "POST" }),
    syncJobs:   (type)        => request(`/data-integrations/${type}/sync/jobs`),
    auditLog:   (type)        => request(`/data-integrations/${type}/audit`),
    disconnect: (type)        => request(`/data-integrations/${type}`, { method: "DELETE" }),
    downloadWordPressPlugin: () => `${API_BASE}/data-integrations/wordpress/plugin-download`,
  },
  settings: {
    getAll: () => request("/settings"),
    get: (key) => request("/settings").then(s => s[key]?.value ?? null),
    set: (key, value, label) =>
      request(`/settings/${key}`, { method: "PUT", body: JSON.stringify({ value, label }) }),
  },
  popup: {
    list: () => request("/popups"),
    create: (data) => request("/popups", { method: "POST", body: JSON.stringify(data) }),
    update: (id, data) => request(`/popups/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    delete: (id) => request(`/popups/${id}`, { method: "DELETE" }),
    getEmails: (id) => request(`/popups/${id}/emails`),
    listTemplates: () => request("/popups/templates"),
    createTemplate: (data) => request("/popups/templates", { method: "POST", body: JSON.stringify(data) }),
    updateTemplate: (id, data) => request(`/popups/templates/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    deleteTemplate: (id) => request(`/popups/templates/${id}`, { method: "DELETE" }),
    getAnalytics: () => request("/popups/analytics"),
    getDailyTrend: () => request("/popups/analytics/daily"),
    getEmailCollected: (params = {}) => {
      const q = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ""))).toString();
      return request(`/popups/email-collected${q ? `?${q}` : ""}`);
    },
    exportEmailCollected: (params = {}) => {
      const q = new URLSearchParams(Object.fromEntries(Object.entries({ ...params, all: "true" }).filter(([, v]) => v != null && v !== ""))).toString();
      return request(`/popups/email-collected${q ? `?${q}` : ""}`);
    },
    createProfile: (emailRecordId) =>
      request(`/popups/email-collected/${emailRecordId}/create-profile`, { method: "POST" }),
    bulkUpdateStatus: (ids, status) =>
      request("/popups/email-collected/bulk-status", { method: "PATCH", body: JSON.stringify({ ids, status }) }),
    getLastActivity: () => request("/popups/last-activity"),
  },
  chartSummaries: {
    async explain(payload) {
      return request("/chart-summaries/explain", { method: "POST", body: JSON.stringify(payload) });
    },
  },
  attributes: {
    list: () => request("/attributes"),
    get: (id) => request(`/attributes/${id}`),
    create: (data) => request("/attributes", { method: "POST", body: JSON.stringify(data) }),
    update: (id, data) => request(`/attributes/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    remove: (id) => request(`/attributes/${id}`, { method: "DELETE" }),
    addValue: (id, value, display_label) =>
      request(`/attributes/${id}/values`, { method: "POST", body: JSON.stringify({ value, display_label }) }),
    updateValue: (valueId, data) =>
      request(`/attributes/values/${valueId}`, { method: "PATCH", body: JSON.stringify(data) }),
    mergeValue: (valueId, target_id) =>
      request(`/attributes/values/${valueId}/merge`, { method: "POST", body: JSON.stringify({ target_id }) }),
    unmergeValue: (valueId) =>
      request(`/attributes/values/${valueId}/unmerge`, { method: "POST" }),
    deleteValue: (valueId) =>
      request(`/attributes/values/${valueId}`, { method: "DELETE" }),
    bulkValues: (value_ids, action, extra = {}) =>
      request("/attributes/values/bulk", { method: "POST", body: JSON.stringify({ value_ids, action, ...extra }) }),
    valuePages: (valueId) => request(`/attributes/values/${valueId}/pages`),
    review: () => request("/attributes/review"),
    taggedPages: (filter) => request(`/attributes/tagged-pages${filter ? `?filter=${filter}` : ""}`),
    reviewPage: (pageId) => request(`/attributes/pages/${pageId}/review`, { method: "POST" }),
    reviewAllPages: () => request("/attributes/tagged-pages/review-all", { method: "POST" }),
    pages: (id) => request(`/attributes/${id}/pages`),
    clone: (id, name) => request(`/attributes/${id}/clone`, { method: "POST", body: JSON.stringify({ name }) }),
    test: (id, body) => request(`/attributes/${id}/test`, { method: "POST", body: JSON.stringify(typeof body === "string" ? { url: body } : (body || {})) }),
    rerunPages: (page_ids, mode) => request("/attributes/web-pages/rerun", { method: "POST", body: JSON.stringify({ page_ids, mode }) }),
    refresh: () => request("/attributes/refresh", { method: "POST" }),
    tag: () => request("/attributes/tag", { method: "POST" }),
    testLinks: () => request("/attributes/test-links"),
    uploadTestLinks: (urls) => request("/attributes/test-links/upload", { method: "POST", body: JSON.stringify({ urls }) }),
    refreshTestLinks: () => request("/attributes/test-links/refresh", { method: "POST" }),
    testLinkSettings: (refresh_mode) => request("/attributes/test-links/settings", { method: "PATCH", body: JSON.stringify({ refresh_mode }) }),
    selectTestLinks: (ids, is_selected) => request("/attributes/test-links/select", { method: "PATCH", body: JSON.stringify({ ids, is_selected }) }),
    deleteTestLink: (linkId) => request(`/attributes/test-links/${linkId}`, { method: "DELETE" }),
    webPages: (params = {}) => {
      const q = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ""))).toString();
      return request(`/attributes/web-pages${q ? `?${q}` : ""}`);
    },
    addWebPage: (url) => request("/attributes/web-pages", { method: "POST", body: JSON.stringify({ url }) }),
    updateWebPage: (pageId, data) => request(`/attributes/web-pages/${pageId}`, { method: "PATCH", body: JSON.stringify(data) }),
    deletePageTag: (pageId, valueId) => request(`/attributes/pages/${pageId}/tags/${valueId}`, { method: "DELETE" }),
    options: () => request("/attributes/options"),
    crawlSettings: () => request("/attributes/crawl-settings"),
    updateCrawlSettings: (data) => request("/attributes/crawl-settings", { method: "PATCH", body: JSON.stringify(data) }),
    profileAttributes: (entityType, entityId) =>
      request(`/attributes/profile/${entityType}/${encodeURIComponent(entityId)}`),
    ruleFields: () => request("/attributes/rule-fields"),
    rulePreview: (scope, rule) => request("/attributes/rule-preview", { method: "POST", body: JSON.stringify({ scope, rule }) }),
    recompute: (id) => request(`/attributes/${id}/recompute`, { method: "POST" }),
    assign: (id, value_id, entity_ids, entity_type, confirm) => request(`/attributes/${id}/assign`, { method: "POST", body: JSON.stringify({ value_id, entity_ids, entity_type, confirm }) }),
    assignSegment: (id, value_id, segment_id, confirm) => request(`/attributes/${id}/assign-segment`, { method: "POST", body: JSON.stringify({ value_id, segment_id, confirm }) }),
    assignImport: (id, value_id, identifiers, entity_type, confirm) => request(`/attributes/${id}/assign-import`, { method: "POST", body: JSON.stringify({ value_id, identifiers, entity_type, confirm }) }),
    unassignProfile: (id, value_id, entity_id, entity_type) => request(`/attributes/${id}/unassign`, { method: "POST", body: JSON.stringify({ value_id, entity_id, entity_type }) }),
    assignments: (id, value_id, limit) => request(`/attributes/${id}/assignments?value_id=${value_id}${limit ? `&limit=${limit}` : ""}`),
    multiAssigned: (id) => request(`/attributes/${id}/multi-assigned`),
    resolveDuplicates: (id, keep) => request(`/attributes/${id}/resolve-duplicates`, { method: "POST", body: JSON.stringify({ keep }) }),
    run: (id) => request(`/attributes/${id}/run`, { method: "POST" }),
    runAll: () => request("/attributes/run", { method: "POST" }),
    autogroup: (id, group_label) =>
      request(`/attributes/${id}/autogroup`, { method: "POST", body: JSON.stringify({ group_label }) }),
    latestJob: (attributeId) => {
      const q = attributeId ? `?attribute_id=${attributeId}` : "";
      return request(`/attributes/jobs/latest${q}`);
    },
    jobs: (attributeId, limit = 10) => {
      const p = new URLSearchParams({ limit: String(limit) });
      if (attributeId) p.set("attribute_id", attributeId);
      return request(`/attributes/jobs?${p.toString()}`);
    },
    suggest: () => request("/attributes/suggest", { method: "POST" }),
    cancelJob: (jobId) => request(`/attributes/jobs/${jobId}/cancel`, { method: "POST" }),
    analytics: () => request("/attributes/analytics"),
  },
  integrations: {
    Core: {
      async InvokeLLM(payload) {
        return request("/integrations/llm", { method: "POST", body: JSON.stringify(payload) });
      },
      async UploadFile({ file }) {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch(`${API_BASE}/integrations/upload`, {
          method: "POST", body: fd, credentials: "include",
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload.error || "Upload failed");
        }
        return res.json();
      },
    },
  },
};
