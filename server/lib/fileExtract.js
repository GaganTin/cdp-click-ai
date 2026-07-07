// ── Uploaded-file text extraction ─────────────────────────────────────────────
// Turns an uploaded file into plain text the analyst LLM can reason over.
// Plain-text formats are read directly; Excel/Word/PDF are parsed with real
// libraries (xlsx, mammoth, pdf-parse), loaded lazily so they don't slow
// process start and are only pulled in when a matching file is actually attached.
import fs from "fs";

// Extensions we read as UTF-8 text as-is.
export const TEXT_EXT = new Set([".csv", ".tsv", ".txt", ".json", ".md", ".log"]);
// Extensions we parse into text with a dedicated library.
export const PARSED_EXT = new Set([".xlsx", ".xls", ".docx", ".pdf"]);
// The full set the analyst can ingest (used for messaging + validation).
export const READABLE_EXT = new Set([...TEXT_EXT, ...PARSED_EXT]);

// A human-friendly list for error messages / the accept attribute.
export const READABLE_LABEL = "CSV, TSV, TXT, JSON, MD, Excel (.xlsx/.xls), Word (.docx), PDF";

// Extract text from `filePath` (already validated to exist). `ext` is the
// lowercased extension incl. the dot. `maxChars` caps the returned string.
// Returns { text } on success, or { error } with a short reason for the model.
export async function extractFileText(filePath, ext, maxChars) {
  const cap = Math.max(0, maxChars || 0);
  if (cap <= 0) return { error: "skipped, attachment size budget reached" };

  try {
    if (TEXT_EXT.has(ext)) {
      // Read only what we need (files can be large); reject if it looks binary.
      const stat = fs.statSync(filePath);
      const readBytes = Math.min(stat.size, cap * 4 + 4096); // utf8 ≤4 bytes/char
      const fd = fs.openSync(filePath, "r");
      const buf = Buffer.alloc(readBytes);
      fs.readSync(fd, buf, 0, readBytes, 0);
      fs.closeSync(fd);
      const text = buf.toString("utf8");
      // Control bytes (excluding tab/newline/CR) → not real text.
      if (/[\x00-\x08\x0E-\x1F]/.test(text)) return { error: "binary, not readable" };
      return { text: clip(text, cap) };
    }

    if (ext === ".xlsx" || ext === ".xls") {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(fs.readFileSync(filePath), { type: "buffer" });
      const chunks = [];
      for (const name of wb.SheetNames) {
        const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name]);
        if (csv.trim()) chunks.push(`# Sheet: ${name}\n${csv}`);
        if (chunks.join("\n\n").length > cap) break;
      }
      const out = chunks.join("\n\n").trim();
      return out ? { text: clip(out, cap) } : { error: "empty spreadsheet" };
    }

    if (ext === ".docx") {
      const mammoth = (await import("mammoth")).default;
      const { value } = await mammoth.extractRawText({ path: filePath });
      const out = (value || "").trim();
      return out ? { text: clip(out, cap) } : { error: "no extractable text (empty or scanned)" };
    }

    if (ext === ".pdf") {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: fs.readFileSync(filePath) });
      try {
        const { text } = await parser.getText();
        const out = (text || "").trim();
        return out ? { text: clip(out, cap) } : { error: "no extractable text (empty or scanned/image-only PDF)" };
      } finally {
        await parser.destroy();
      }
    }

    return { error: `${ext || "binary"} file, unsupported format` };
  } catch (err) {
    return { error: `could not be parsed (${(err && err.message) || "unknown error"})` };
  }
}

function clip(s, cap) {
  return s.length > cap ? s.slice(0, cap) : s;
}
