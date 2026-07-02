import { useState, useRef } from "react";
import { Upload, RefreshCw, X as XIcon, Link2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { appClient } from "@/api/appClient";
import { toast } from "sonner";

// Reusable "upload your own image OR paste a URL" field shared by the email and
// pop-up builders (block images and container background images). Uploads go
// through the same Core.UploadFile endpoint used elsewhere and return a hosted
// file_url; a thumbnail preview + clear button keep it friendly.
export function ImageUploadField({
  label = "Image",
  value,
  onChange,
  placeholder = "Or paste an image URL…",
  previewClassName = "h-20",
}) {
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      e.target.value = "";
      return;
    }
    // Guard against oversized uploads (email clients choke on huge inline images).
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image is larger than 5 MB — please use a smaller file");
      e.target.value = "";
      return;
    }
    setUploading(true);
    try {
      const result = await appClient.integrations.Core.UploadFile({ file });
      onChange(result.file_url);
      toast.success("Image uploaded");
    } catch (err) {
      toast.error(err.message || "Upload failed");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  return (
    <div className="space-y-2">
      {label && <Label className="text-[11px] text-muted-foreground block">{label}</Label>}

      {value && (
        <div className={`relative w-full ${previewClassName} rounded border border-border overflow-hidden bg-secondary/20`}>
          <img src={value} alt="" className="w-full h-full object-contain" />
          <button
            type="button"
            onClick={() => onChange("")}
            className="absolute top-1 right-1 w-5 h-5 bg-white/85 hover:bg-white rounded-full flex items-center justify-center shadow-sm border border-border text-muted-foreground hover:text-destructive transition-colors"
            title="Remove image"
          >
            <XIcon className="w-3 h-3" />
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        className="w-full h-8 flex items-center justify-center gap-1.5 rounded border border-dashed border-border bg-secondary/30 hover:bg-secondary/60 text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-60"
      >
        {uploading
          ? <><RefreshCw className="w-3 h-3 animate-spin" /> Uploading…</>
          : <><Upload className="w-3 h-3" /> Upload from computer</>}
      </button>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />

      <div className="relative">
        <Link2 className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
        <Input
          value={value || ""}
          onChange={e => onChange(e.target.value)}
          className="h-7 text-xs pl-7"
          placeholder={placeholder}
        />
      </div>
    </div>
  );
}

export default ImageUploadField;
