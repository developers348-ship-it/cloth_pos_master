"use client";

import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A settings card whose body folds away when its header is clicked.
 *
 * The body stays mounted while closed (just hidden), so anything typed into a
 * form or picked in a section survives being collapsed.
 */
export default function CollapsibleCard({
  title,
  hint,
  aside,
  defaultOpen = false,
  urdu = false,
  className,
  children,
}: {
  title: React.ReactNode;
  hint?: React.ReactNode;
  /** Shown at the right of the header, e.g. a status badge. */
  aside?: React.ReactNode;
  defaultOpen?: boolean;
  urdu?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  const u = urdu ? "urdu-text" : "";

  return (
    <div className={cn("bg-white rounded-2xl shadow-sm border border-gray-100 p-6", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={bodyId}
        className={cn("w-full flex items-start justify-between gap-4 text-start", open && "border-b pb-3")}
      >
        <span className="min-w-0">
          <span className={cn("font-semibold text-gray-700 flex items-center gap-2", u)}>{title}</span>
          {hint && <span className={cn("block text-sm font-normal text-gray-500 mt-1", u)}>{hint}</span>}
        </span>
        <span className="flex items-center gap-3 shrink-0">
          {aside}
          <ChevronDown className={cn("w-5 h-5 text-gray-400 transition-transform", open && "rotate-180")} />
        </span>
      </button>
      <div id={bodyId} hidden={!open} className="space-y-5 mt-5">
        {children}
      </div>
    </div>
  );
}
