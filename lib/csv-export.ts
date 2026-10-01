/**
 * Client-side CSV export utility.
 * Converts an array of plain objects to a CSV blob and triggers a browser download.
 */
export function exportCSV(
  filename: string,
  rows: Record<string, unknown>[],
  headers?: string[]
): void {
  if (!rows || rows.length === 0) {
    alert("No data to export.");
    return;
  }

  const keys = headers ?? Object.keys(rows[0]);

  const escape = (val: unknown): string => {
    if (val === null || val === undefined) return "";
    const str = String(val);
    // Wrap in quotes if contains comma, quote, or newline
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const lines: string[] = [
    keys.map(escape).join(","),
    ...rows.map((row) => keys.map((k) => escape(row[k])).join(",")),
  ];

  const csv = lines.join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
