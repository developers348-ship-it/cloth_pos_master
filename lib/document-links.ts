/**
 * The URLs of the two document detail pages, in one place.
 *
 * `invoiceHref` and `grnHref` started life as private helpers in the sales
 * report and the GRN records tab, each with a comment saying one place should
 * build the URL so a row's number link and its detail action can't diverge.
 * The Ledger page needs both — a statement line, a recovery, a payment and an
 * installment all point at one of these two documents — so the helpers moved
 * here rather than being copied a third time.
 *
 * Both take the document's **id** (the cuid), not its human-facing
 * `invoiceNo` / `grnNo`.
 */

export function invoiceHref(id: string): string {
  return `/dashboard/invoices/${id}`;
}

export function grnHref(id: string): string {
  return `/dashboard/purchases/${id}`;
}
