const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
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
    logout: (redirectTo) => {
      if (redirectTo) window.location.href = redirectTo;
    },
    redirectToLogin: () => {
      window.location.href = "/";
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
        } catch {
          // silent polling failure
        }
      };

      pull();
      const timer = window.setInterval(pull, intervalMs);
      return () => {
        cancelled = true;
        window.clearInterval(timer);
      };
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
      const q = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([,v]) => v != null && v !== ""))).toString();
      return request(`/profiles/customers${q ? `?${q}` : ""}`);
    },
    async customerFilters() {
      return request("/profiles/customer-filters");
    },
    async listAnonymous(params = {}) {
      const q = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([,v]) => v != null && v !== ""))).toString();
      return request(`/profiles/anonymous${q ? `?${q}` : ""}`);
    },
    async anonymousFilters() {
      return request("/profiles/anonymous-filters");
    },
    async refresh() {
      return request("/profiles/refresh", { method: "POST" });
    },
  },
  chartSummaries: {
    async explain(payload) {
      return request("/chart-summaries/explain", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
  },
  integrations: {
    Core: {
      async InvokeLLM(payload) {
        return request("/integrations/llm", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      },
      async UploadFile({ file }) {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch(`${API_BASE}/integrations/upload`, {
          method: "POST",
          body: fd,
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
