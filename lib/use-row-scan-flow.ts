"use client";

import { useEffect, useRef } from "react";
import { SCAN_KEY_GAP_MS, MIN_SCAN_LENGTH } from "@/components/items/BarcodeScanner";

/**
 * The line-entry behaviour the sales screen and the GRN screen share: knowing
 * when a code was *scanned* into a row's item box rather than typed, and
 * walking the cursor down to the next row once the item lands.
 *
 * Both screens are a table of rows whose first cell is an item box, so this is
 * generic over anything with an `id`.
 */
export function useRowScanFlow<T extends { id: string }>({
  rows,
  setRows,
  makeEmptyRow,
}: {
  rows: T[];
  setRows: React.Dispatch<React.SetStateAction<T[]>>;
  makeEmptyRow: () => T;
}) {
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  // Set when a row's box must take focus once it exists — a row appended for
  // the next scan has no input to focus until React has committed it.
  const pendingFocusRef = useRef<string | null>(null);
  // Tracks a burst of keystrokes inside one row's item box. A scanner types a
  // whole code faster than SCAN_KEY_GAP_MS per character; a person searching
  // by name does not.
  const scanBufferRef = useRef({ rowId: "", text: "", at: 0 });

  // Focus a row queued by `focusRowAfter` that didn't exist yet. Runs after
  // every commit, so it fires as soon as the new input mounts.
  useEffect(() => {
    const id = pendingFocusRef.current;
    if (!id) return;
    const el = inputRefs.current[id];
    if (el) { pendingFocusRef.current = null; el.focus(); }
  });

  /** `ref` callback for a row's item box. */
  function setInputRef(rowId: string, el: HTMLInputElement | null) {
    inputRefs.current[rowId] = el;
  }

  /** Drop a deleted row's entry so the map doesn't grow for the session. */
  function forgetRow(rowId: string) {
    delete inputRefs.current[rowId];
  }

  /**
   * Moves the cursor to the item box on the row after `rowId`, appending a row
   * when there isn't one, so a run of scans walks straight down the document
   * without the operator touching the mouse.
   *
   * `rows` is the pre-update value when this is called right after a
   * `setRows`, which is fine: an item landing in an existing blank row doesn't
   * change the length, and one that appended a row makes the append below
   * correct anyway.
   */
  function focusRowAfter(rowId: string) {
    const idx = rows.findIndex((r) => r.id === rowId);
    if (idx === -1) return;
    const next = rows[idx + 1];
    if (next) { inputRefs.current[next.id]?.focus(); return; }
    const row = makeEmptyRow();
    pendingFocusRef.current = row.id;
    setRows((prev) => [...prev, row]);
  }

  /** Records one printable keystroke in a row's item box, for `wasRowScan`. */
  function noteRowKey(rowId: string, key: string) {
    const now = Date.now();
    const buf = scanBufferRef.current;
    const continues = buf.rowId === rowId && now - buf.at <= SCAN_KEY_GAP_MS;
    scanBufferRef.current = { rowId, text: continues ? buf.text + key : key, at: now };
  }

  /**
   * True when the box's entire contents arrived as one uninterrupted burst —
   * i.e. a scanner typed it. Requiring the burst to equal the whole value is
   * what stops a fast typist finishing a name from being read as a code: their
   * earlier keystrokes broke the burst, so the buffer holds only the tail.
   */
  function wasRowScan(rowId: string, typed: string) {
    const buf = scanBufferRef.current;
    return buf.rowId === rowId && buf.text === typed && typed.length >= MIN_SCAN_LENGTH;
  }

  return { setInputRef, forgetRow, focusRowAfter, noteRowKey, wasRowScan };
}
