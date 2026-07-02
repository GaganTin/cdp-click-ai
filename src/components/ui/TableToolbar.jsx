import { useState, useRef, useEffect } from "react";
import { Search, Filter, Layout, Download, ChevronUp, ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MultiSelect } from "@/components/ui/multi-select";

// A filter value counts as "active" when it's a non-empty string or a non-empty array.
const isFilterActive = (v) => (Array.isArray(v) ? v.length > 0 : v != null && v !== "");
// The empty value for a column's filter, matching its input type.
const emptyFilter = (col) => (col?.filterType === "multiselect" ? [] : "");

/**
 * Reusable data-table toolbar: search, column-based filters, column visibility+order, CSV export.
 *
 * columns: [{
 *   key:        string       - field name
 *   label:      string       - display label
 *   filterable: boolean      - show in filter panel (default false)
 *   type:       'text'|'date'            - text/date filter input (default 'text')
 *   filterType: 'multiselect'            - searchable multi-select (value is string[]); needs options
 *   options:    string[]     - values for a plain <select> or the multi-select
 *   defaultVisible: boolean  - initial visibility (default true)
 * }]
 *
 * Filter values are strings for text/select columns and string[] for multiselect
 * columns; consumers filtering rows must handle both shapes.
 *
 * colOrder: string[] - current key order (controls column sequence)
 * hiddenCols: Set<string>
 * filters: { [key]: string }
 */
export default function TableToolbar({
  search = "",
  onSearch,
  columns = [],
  colOrder = [],
  hiddenCols = new Set(),
  onToggleCol,
  onMoveCol,
  filters = {},
  onFilter,
  onExport,
  resultCount,
  totalCount,
  placeholder = "Search...",
  extraButtons,
}) {
  const [showFilters, setShowFilters] = useState(false);
  const [showCols, setShowCols] = useState(false);
  const colRef = useRef(null);
  const filterRef = useRef(null);

  // Close dropdowns on outside click. Clicks inside a portaled MultiSelect popover
  // are ignored so choosing a filter value doesn't collapse the filter panel.
  useEffect(() => {
    const handler = (e) => {
      if (e.target.closest?.("[data-multiselect-popover]")) return;
      if (colRef.current && !colRef.current.contains(e.target)) setShowCols(false);
      if (filterRef.current && !filterRef.current.contains(e.target)) setShowFilters(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const hasActiveFilters = Object.values(filters).some(isFilterActive);
  const activeFilterPills = Object.entries(filters).filter(([, v]) => isFilterActive(v));
  const filterableCols = columns.filter(c => c.filterable);
  const visibleCount = colOrder.filter(k => !hiddenCols.has(k)).length;

  const clearAllFilters = () => {
    filterableCols.forEach(c => onFilter(c.key, emptyFilter(c)));
  };

  return (
    <div className="space-y-2 mb-4">
      {/* Toolbar row */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Search */}
        <div className="relative flex-1 min-w-[160px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            value={search}
            onChange={e => onSearch(e.target.value)}
            placeholder={placeholder}
            className="w-full h-9 pl-9 pr-8 text-sm bg-background border border-input rounded-md outline-none focus:ring-1 focus:ring-ring"
          />
          {search && (
            <button
              onClick={() => onSearch("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Filter */}
        <div ref={filterRef} className="relative">
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5"
            onClick={() => { setShowFilters(v => !v); setShowCols(false); }}
          >
            <Filter className="w-3.5 h-3.5" />
            Filters
            {hasActiveFilters && <span className="w-1.5 h-1.5 rounded-full bg-foreground flex-shrink-0" />}
          </Button>

          {showFilters && filterableCols.length > 0 && (
            <div className="absolute left-0 top-full mt-1.5 z-30 bg-popover border border-border rounded-lg shadow-lg p-5 w-80 md:w-[480px]">
              <div className="flex items-center justify-between mb-4">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Filter by column</p>
                {hasActiveFilters && (
                  <button onClick={clearAllFilters} className="text-[11px] text-muted-foreground hover:text-foreground">
                    Clear all
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3.5 max-h-72 overflow-y-auto pr-1 -mr-1">
                {filterableCols.map(col => {
                  const isMulti = col.filterType === "multiselect";
                  const val = filters[col.key] ?? (isMulti ? [] : "");
                  return (
                    <div key={col.key}>
                      <p className="text-[10px] text-muted-foreground mb-1.5 truncate">{col.label}</p>
                      {isMulti ? (
                        <MultiSelect
                          options={col.options || []}
                          value={Array.isArray(val) ? val : []}
                          onChange={next => onFilter(col.key, next)}
                          placeholder="All"
                          searchPlaceholder={`Search ${col.label.toLowerCase()}…`}
                        />
                      ) : col.options ? (
                        <select
                          value={val}
                          onChange={e => onFilter(col.key, e.target.value)}
                          className="w-full h-8 px-2 text-xs bg-background border border-input rounded-md text-foreground"
                        >
                          <option value="">All</option>
                          {col.options.map(o => (
                            <option key={o} value={o}>{o}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type={col.type === "date" ? "date" : "text"}
                          value={val}
                          onChange={e => onFilter(col.key, e.target.value)}
                          placeholder={`Filter...`}
                          className="w-full h-8 px-2 text-xs bg-background border border-input rounded-md outline-none focus:ring-1 focus:ring-ring"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Columns */}
        <div ref={colRef} className="relative">
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5"
            onClick={() => { setShowCols(v => !v); setShowFilters(false); }}
          >
            <Layout className="w-3.5 h-3.5" />
            Columns ({visibleCount})
          </Button>

          {showCols && (
            <div className="absolute right-0 top-full mt-1 z-30 bg-popover border border-border rounded-lg shadow-lg p-3 w-56">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Show / reorder columns
              </p>
              <div className="space-y-0.5 max-h-72 overflow-y-auto pr-0.5">
                {colOrder.map((key, idx) => {
                  const col = columns.find(c => c.key === key);
                  if (!col) return null;
                  const isVisible = !hiddenCols.has(key);
                  return (
                    <div
                      key={key}
                      className="flex items-center gap-1 px-1 py-1 rounded hover:bg-secondary/50 group"
                    >
                      <label className="flex items-center gap-2 flex-1 cursor-pointer min-w-0">
                        <input
                          type="checkbox"
                          checked={isVisible}
                          onChange={() => onToggleCol(key)}
                          className="rounded flex-shrink-0"
                        />
                        <span className="text-xs truncate">{col.label}</span>
                      </label>
                      <div className="flex flex-col opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => onMoveCol(key, "up")}
                          disabled={idx === 0}
                          className="text-muted-foreground hover:text-foreground disabled:opacity-20 p-0.5 leading-none"
                        >
                          <ChevronUp className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => onMoveCol(key, "down")}
                          disabled={idx === colOrder.length - 1}
                          className="text-muted-foreground hover:text-foreground disabled:opacity-20 p-0.5 leading-none"
                        >
                          <ChevronDown className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Export */}
        {onExport && (
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={onExport}>
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </Button>
        )}

        {/* Extra buttons slot (e.g. Add button) */}
        {extraButtons}

        {/* Row count */}
        {resultCount !== undefined && totalCount !== undefined && (
          <span className="text-xs text-muted-foreground ml-auto">
            {resultCount !== totalCount
              ? `${resultCount.toLocaleString()} of ${totalCount.toLocaleString()} rows`
              : `${totalCount.toLocaleString()} rows`}
          </span>
        )}
      </div>

      {/* Active filter pills */}
      {activeFilterPills.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {activeFilterPills.map(([key, val]) => {
            const col = columns.find(c => c.key === key);
            const display = Array.isArray(val) ? val.join(", ") : val;
            return (
              <span
                key={key}
                className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border border-border bg-secondary/40 max-w-[240px]"
              >
                <span className="truncate">{col?.label ?? key}: <strong>{display}</strong></span>
                <button
                  onClick={() => onFilter(key, emptyFilter(col))}
                  className="hover:text-foreground text-muted-foreground ml-0.5 flex-shrink-0"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            );
          })}
          <button
            onClick={clearAllFilters}
            className="text-[11px] text-muted-foreground hover:text-foreground"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * useTableState - manages column visibility, order, filters, and search for a table.
 *
 * columns: column definitions (same shape as TableToolbar columns)
 * Returns: { search, setSearch, filters, setFilter, colOrder, hiddenCols, toggleCol, moveCol, exportCsv }
 */
export function useTableState(columns, data = [], { csvFilename = "export.csv" } = {}) {
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({});
  const [colOrder, setColOrder] = useState(() => columns.map(c => c.key));
  const [hiddenCols, setHiddenCols] = useState(
    () => new Set(columns.filter(c => c.defaultVisible === false).map(c => c.key))
  );

  const setFilter = (key, value) => setFilters(prev => ({ ...prev, [key]: value }));

  const toggleCol = (key) => {
    setHiddenCols(prev => {
      const next = new Set(prev);
      if (next.has(key)) { next.delete(key); }
      else if (colOrder.filter(k => !next.has(k)).length > 1) { next.add(key); }
      return next;
    });
  };

  const moveCol = (key, dir) => {
    setColOrder(prev => {
      const idx = prev.indexOf(key);
      if (idx === - 1) return prev;
      const next = [...prev];
      if (dir === "up" && idx > 0) {
        [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      } else if (dir === "down" && idx < prev.length - 1) {
        [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      }
      return next;
    });
  };

  const visibleCols = colOrder
    .filter(k => !hiddenCols.has(k))
    .map(k => columns.find(c => c.key === k))
    .filter(Boolean);

  const filteredData = data.filter(row => {
    if (search) {
      const q = search.toLowerCase();
      const searchableCols = columns.filter(c => c.searchable !== false);
      if (!searchableCols.some(c => String(row[c.key] ?? "").toLowerCase().includes(q))) return false;
    }
    for (const [key, val] of Object.entries(filters)) {
      if (!val) continue;
      const rowVal = String(row[key] ?? "").toLowerCase();
      if (!rowVal.includes(val.toLowerCase())) return false;
    }
    return true;
  });

  const exportCsv = (rows = filteredData) => {
    const header = visibleCols.map(c => c.label).join(",");
    const body = rows.map(row =>
      visibleCols.map(c => {
        const v = String(row[c.key] ?? "");
        return v.includes(",") || v.includes('"') || v.includes("\n") ? `"${v.replace(/"/g, '""')}"` : v;
      }).join(",")
    ).join("\n");
    const blob = new Blob([`${header}\n${body}`], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = csvFilename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  return {
    search, setSearch,
    filters, setFilter,
    colOrder, hiddenCols, toggleCol, moveCol,
    visibleCols,
    filteredData,
    exportCsv,
  };
}
