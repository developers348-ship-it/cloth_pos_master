"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";

export type ActionMenuTone = "default" | "success" | "warning" | "danger";

export type ActionMenuItem = {
  key: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  onSelect: () => void;
  tone?: ActionMenuTone;
  disabled?: boolean;
};

const TONE_CLASS: Record<ActionMenuTone, string> = {
  default: "text-gray-700 hover:bg-gray-50",
  success: "text-green-700 hover:bg-green-50",
  warning: "text-orange-700 hover:bg-orange-50",
  danger: "text-red-700 hover:bg-red-50",
};

const MENU_WIDTH = 200;

/**
 * Row-level actions collapsed behind one trigger.
 *
 * The menu is portalled to `document.body` and positioned `fixed` from the
 * trigger's rect rather than absolutely inside the row: every table on this app
 * sits in an `overflow-x-auto` wrapper, which would clip a normally-positioned
 * dropdown on the last rows and the right-hand column. For the same reason it
 * closes on scroll — a fixed menu does not travel with the content beneath it.
 */
export default function ActionMenu({
  items,
  label,
  disabled,
  align = "end",
  isUrdu,
}: {
  items: ActionMenuItem[];
  /** Text on the trigger; omit for an icon-only button. */
  label?: string;
  disabled?: boolean;
  /** Which edge of the trigger the menu lines up with. */
  align?: "start" | "end";
  isUrdu?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const visible = items.filter((i) => !!i);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const height = Math.min(visible.length * 38 + 8, 320);
    // Flip above the trigger when the rows near the bottom of the window
    // wouldn't leave room below it.
    const below = window.innerHeight - r.bottom;
    const top = below < height + 8 && r.top > height + 8 ? r.top - height - 4 : r.bottom + 4;
    const rawLeft = align === "end" ? r.right - MENU_WIDTH : r.left;
    const left = Math.max(8, Math.min(rawLeft, window.innerWidth - MENU_WIDTH - 8));
    setPos({ top, left });
  }, [open, align, visible.length]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    const close = () => setOpen(false);
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  if (visible.length === 0) return null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50 ${
          open ? "bg-gray-50 border-gray-300" : ""
        }`}
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
        {label && <span className={isUrdu ? "urdu-text" : ""}>{label}</span>}
      </button>

      {open && pos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ top: pos.top, left: pos.left, width: MENU_WIDTH }}
            className="fixed z-50 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-lg"
          >
            {visible.map((item) => (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs disabled:opacity-40 disabled:hover:bg-transparent ${
                  TONE_CLASS[item.tone ?? "default"]
                }`}
              >
                {item.icon ? <item.icon className="h-3.5 w-3.5 shrink-0" /> : <span className="w-3.5" />}
                <span className={isUrdu ? "urdu-text" : ""}>{item.label}</span>
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}
