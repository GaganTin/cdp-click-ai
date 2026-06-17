import { describe, it, expect, vi, afterEach } from "vitest";

// Mock the heavy crawl/AI deps so importing the queue is clean and fast. Our
// tests use an unsupported job_type, so the worker never enters runContentJob
// and these stubs are never actually called - they just keep the import light.
vi.mock("../server/lib/webCrawler.js", () => ({
  crawlPage: vi.fn(), discoverUrls: vi.fn(), contentHash: () => "h",
  closeBrowser: vi.fn(), isValidTitle: () => true,
  fetchSitemapLastmod: vi.fn(async () => new Map()), normUrl: (u) => u,
}));
vi.mock("../server/lib/attributeAI.js", () => ({ tagPage: vi.fn(), isAIConfigured: () => false }));
vi.mock("../server/lib/contentScrapeTrigger.js", () => ({ triggerContentScrape: vi.fn(async () => ({ triggered: false })) }));

const { processNextAttributeJob, startAttributeQueueWorker } = await import("../server/lib/attributeQueue.js");

const isClaim = (sql) => /SET status = 'running'/.test(sql);

// A mock pool whose claim query (UPDATE … SET status='running') pops the next
// job off `queue`, and whose every other query resolves empty. Jobs use an
// unsupported job_type so drainAttributeJobs takes the cheap setJob branch.
function makeQueuePool(jobs) {
  const queue = jobs.map((j, i) => ({ id: `job${i}`, job_type: "nope", ...j }));
  const claimSqls = [];
  const pool = {
    query: vi.fn(async (sql) => {
      if (isClaim(sql)) {
        claimSqls.push(sql);
        const job = queue.shift() || null;
        return { rows: job ? [job] : [], rowCount: job ? 1 : 0 };
      }
      return { rows: [], rowCount: 0 };
    }),
  };
  return { pool, queue, claimSqls };
}

afterEach(() => { vi.useRealTimers(); });

describe("attribute queue - concurrent fair worker", () => {
  it("drains every queued job", async () => {
    const { pool, queue } = makeQueuePool(
      Array.from({ length: 7 }, (_, i) => ({ company_id: `c${i}` }))
    );
    processNextAttributeJob(pool);
    await vi.waitFor(() => expect(queue.length).toBe(0));
  });

  it("claim skips companies with a running job and uses SKIP LOCKED (fairness + no double-run)", async () => {
    const { pool, claimSqls } = makeQueuePool([{ company_id: "c1" }]);
    processNextAttributeJob(pool);
    await vi.waitFor(() => expect(claimSqls.length).toBeGreaterThan(0));
    const sql = claimSqls[0];
    expect(sql).toMatch(/NOT EXISTS/);
    expect(sql).toMatch(/r\.company_id = j\.company_id AND r\.status = 'running'/);
    expect(sql).toMatch(/FOR UPDATE OF j SKIP LOCKED/);
    expect(sql).toMatch(/ORDER BY j\.created_date ASC/);
  });

  it("never runs more than the concurrency cap (3) of workers at once", async () => {
    let inFlight = 0, peak = 0;
    const jobs = Array.from({ length: 9 }, (_, i) => ({ id: `j${i}`, company_id: `c${i}`, job_type: "nope" }));
    const pool = {
      query: vi.fn(async (sql) => {
        if (isClaim(sql)) {
          inFlight++; peak = Math.max(peak, inFlight);
          await Promise.resolve(); await Promise.resolve();   // let siblings enter
          inFlight--;
          const job = jobs.shift() || null;
          return { rows: job ? [job] : [], rowCount: job ? 1 : 0 };
        }
        return { rows: [], rowCount: 0 };
      }),
    };
    processNextAttributeJob(pool);
    await vi.waitFor(() => expect(jobs.length).toBe(0));
    await vi.waitFor(() => expect(inFlight).toBe(0));
    expect(peak).toBe(3);
  });

  it("tops the pool back up after draining (no worker-count leak)", async () => {
    const h = makeQueuePool([{ company_id: "c1" }]);
    processNextAttributeJob(h.pool);
    await vi.waitFor(() => expect(h.queue.length).toBe(0));
    // If _activeWorkers had leaked above the cap, this second batch would never drain.
    h.queue.push({ id: "again", company_id: "c2", job_type: "nope" });
    processNextAttributeJob(h.pool);
    await vi.waitFor(() => expect(h.queue.length).toBe(0));
  });

  it("keeps draining after one job's processing throws", async () => {
    const jobs = Array.from({ length: 3 }, (_, i) => ({ id: `j${i}`, company_id: `c${i}`, job_type: "nope" }));
    let threw = false;
    const pool = {
      query: vi.fn(async (sql) => {
        if (isClaim(sql)) {
          const job = jobs.shift() || null;
          return { rows: job ? [job] : [], rowCount: job ? 1 : 0 };
        }
        if (!threw) { threw = true; throw new Error("boom while marking job"); }  // first setJob fails
        return { rows: [], rowCount: 0 };
      }),
    };
    processNextAttributeJob(pool);
    await vi.waitFor(() => expect(jobs.length).toBe(0));
    expect(threw).toBe(true);
  });
});

describe("attribute queue - stale-job reset", () => {
  it("resets only jobs idle past the (parameterized) stale window, default 45 min", async () => {
    vi.useFakeTimers();
    const staleCalls = [];
    const pool = {
      query: vi.fn(async (sql, params) => {
        if (/updated_date < NOW\(\) - \(\$1::int/.test(sql)) staleCalls.push({ sql, params });
        return { rows: [], rowCount: 0 };   // empty claims, empty reset
      }),
    };
    startAttributeQueueWorker(pool);
    await vi.advanceTimersByTimeAsync(3100);   // fire the initial 3s tick (not the 30s interval)
    expect(staleCalls.length).toBeGreaterThan(0);
    expect(staleCalls[0].sql).toMatch(/status = 'running'/);
    expect(staleCalls[0].sql).toMatch(/INTERVAL '1 minute'/);
    expect(staleCalls[0].params).toEqual([45]);
  });
});
