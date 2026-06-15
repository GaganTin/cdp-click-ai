import * as React from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";

// Searchable multi-select. `value` is an array of selected values; `onChange` gets
// the next array. `options` accepts strings or { value, label } objects.
// The dropdown is portaled (escapes scrollable filter panels); it carries a
// data-multiselect-popover marker so a page's outside-click handler can ignore it.
export function MultiSelect({
  options = [],
  value = [],
  onChange,
  placeholder = "All",
  searchPlaceholder = "Search…",
  emptyText = "No matches.",
  className,
  disabled,
}) {
  const [open, setOpen] = React.useState(false);
  const norm = options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  const selected = new Set(value);

  const toggle = (v) => {
    const next = new Set(selected);
    next.has(v) ? next.delete(v) : next.add(v);
    onChange([...next]);
  };

  const label =
    value.length === 0 ? placeholder
    : value.length === 1 ? (norm.find((o) => o.value === value[0])?.label ?? String(value[0]))
    : `${value.length} selected`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "flex items-center justify-between gap-1 w-full h-8 px-2 text-xs bg-background border border-input rounded-md text-foreground disabled:opacity-50",
            className
          )}
        >
          <span className={cn("truncate", value.length === 0 && "text-muted-foreground")}>{label}</span>
          <ChevronDown className="w-3.5 h-3.5 opacity-50 flex-shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        data-multiselect-popover=""
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-[200px] p-0"
      >
        <Command>
          <CommandInput placeholder={searchPlaceholder} className="h-9 text-xs" />
          <CommandList>
            <CommandEmpty className="py-4 text-center text-xs">{emptyText}</CommandEmpty>
            <CommandGroup>
              {norm.map((o) => (
                <CommandItem key={o.value} value={o.label} onSelect={() => toggle(o.value)} className="gap-2 cursor-pointer text-xs">
                  <div
                    className={cn(
                      "flex h-4 w-4 items-center justify-center rounded border border-input flex-shrink-0",
                      selected.has(o.value) ? "bg-foreground text-background" : "opacity-50"
                    )}
                  >
                    {selected.has(o.value) && <Check className="h-3 w-3" />}
                  </div>
                  <span className="truncate">{o.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
