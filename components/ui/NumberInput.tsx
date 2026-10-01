"use client";

import { useState } from "react";

/**
 * A numeric input that can actually be typed into.
 *
 * The plain `<input type="number" value={n} onChange={e => set(Number(e.target.value))} />`
 * pattern this replaces has two everyday faults on the till:
 *
 * - **The zero can't be cleared.** Backspacing gives `""`, `Number("")` is 0, and
 *   the field re-renders as "0" — so the next digit lands next to it and you get
 *   "05", or "50" if the caret sat to the left.
 * - **Decimals below one can't be typed.** Where the value was mapped with
 *   `Number(v) || 0`, typing the "0" of "0.5" produces 0, which renders as an
 *   empty box, and the decimal point has nothing to attach to.
 *
 * The fix is to let the *text* be the source of truth while the box is being
 * edited, and the number take over again once it isn't. `draft` holds the raw
 * string during typing; on blur it is dropped and the canonical number is shown.
 * A blank box reports 0 to the parent without forcing "0" back into the field.
 *
 * Focus selects the current contents, so tapping a field and typing replaces the
 * figure instead of appending to it — the behaviour a cashier expects.
 */

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
  value: number;
  onChange: (value: number) => void;
  /** Clamp or round the parsed figure before it reaches the parent. */
  transform?: (value: number) => number;
  /** Render 0 as an empty box (with the placeholder showing) rather than "0". */
  blankZero?: boolean;
};

function parse(raw: string): number {
  if (raw.trim() === "") return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

export default function NumberInput({
  value, onChange, transform, blankZero, onFocus, onBlur, ...rest
}: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const [seen, setSeen] = useState(value);

  // Adjusting state during render (the documented React pattern) rather than in
  // an effect: when the parent changes the value to something other than what
  // this draft represents — a clamp, a reset, a recalculated line — the draft is
  // stale and has to go. Typing doesn't trip this, because the parent's value is
  // then exactly what the draft parses to.
  if (value !== seen) {
    setSeen(value);
    if (draft !== null && parse(draft) !== value) setDraft(null);
  }

  const shown = draft ?? (blankZero && value === 0 ? "" : String(value));

  return (
    <input
      {...rest}
      type="number"
      value={shown}
      onChange={(e) => {
        const raw = e.target.value;
        const parsed = parse(raw);
        const next = transform ? transform(parsed) : parsed;
        // When a transform actually changed the figure (a clamp to the credit a
        // customer holds, say), show the clamped number straight away rather
        // than leaving the typed one sitting in a box that no longer means it.
        setDraft(next === parsed ? raw : null);
        setSeen(next);
        onChange(next);
      }}
      onFocus={(e) => {
        e.target.select();
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setDraft(null);
        onBlur?.(e);
      }}
    />
  );
}
