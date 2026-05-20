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
    throw new Error(payload.error || `Request failed: ${res.status}`);
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
    resetPassword: (token, new_password) =>
      request("/auth/reset-password", { method: "POST", body: JSON.stringify({ token, new_password }) }),
    redirectToLogin: () => { window.location.href = "/login"; },
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
    getInvoices: () => request("/billing/invoices"),
  },
  support: {
    listTickets:  () => request("/support/tickets"),
    createTicket: (data) => request("/support/tickets", { method: "POST", body: JSON.stringify(data) }),
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
  functions: {
    async invoke(name, payload) {
      return request(`/functions/${name}`, {
        method: "POST",
        body: JSON.stringify(payload || {}),
      });
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
  },
  edm: {
    listCampaigns: () => request("/edm/campaigns"),
    createCampaign: (data) => request("/edm/campaigns", { method: "POST", body: JSON.stringify(data) }),
    getCampaign: (id) => request(`/edm/campaigns/${id}`),
    updateCampaign: (id, data) => request(`/edm/campaigns/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    deleteCampaign: (id) => request(`/edm/campaigns/${id}`, { method: "DELETE" }),
    sendCampaign: (id) => request(`/edm/campaigns/${id}/send`, { method: "POST" }),
    cancelCampaign: (id) => request(`/edm/campaigns/${id}/cancel`, { method: "POST" }),
    getCampaignStats: (id) => request(`/edm/campaigns/${id}/stats`),
    getCampaignSends: (id) => request(`/edm/campaigns/${id}/sends`),
    getRecipientsPreview: (id) => request(`/edm/campaigns/${id}/recipients/preview`),
    previewRecipientsBySegment: () => request("/edm/recipients/preview"),
    testSend: (payload) => request("/edm/test-send", { method: "POST", body: JSON.stringify(payload) }),
    listTemplates: () => request("/edm/templates"),
    createTemplate: (data) => request("/edm/templates", { method: "POST", body: JSON.stringify(data) }),
    updateTemplate: (id, data) => request(`/edm/templates/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    deleteTemplate: (id) => request(`/edm/templates/${id}`, { method: "DELETE" }),
    listSuppression: () => request("/edm/suppression"),
    addSuppression: (email, reason = "manual") => request("/edm/suppression", { method: "POST", body: JSON.stringify({ email, reason }) }),
    removeSuppression: (email) => request(`/edm/suppression/${encodeURIComponent(email)}`, { method: "DELETE" }),
    listAutomations: () => request("/edm/automations"),
    createAutomation: (data) => request("/edm/automations", { method: "POST", body: JSON.stringify(data) }),
    updateAutomation: (id, data) => request(`/edm/automations/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    deleteAutomation: (id) => request(`/edm/automations/${id}`, { method: "DELETE" }),
  },
  dataIntegrations: {
    list: () => request("/data-integrations"),
    get: (type) => request(`/data-integrations/${type}`),
    connect: (type, config) =>
      request(`/data-integrations/${type}/connect`, { method: "POST", body: JSON.stringify(config) }),
    sync: (type) => request(`/data-integrations/${type}/sync`, { method: "POST" }),
    disconnect: (type) => request(`/data-integrations/${type}`, { method: "DELETE" }),
    check: (type) => request(`/data-integrations/${type}/check`, { method: "POST" }),
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
  },
  chartSummaries: {
    async explain(payload) {
      return request("/chart-summaries/explain", { method: "POST", body: JSON.stringify(payload) });
    },
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
