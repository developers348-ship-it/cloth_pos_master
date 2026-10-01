# Dashboard

`app/dashboard/page.tsx` is a **server component**. It renders, top to bottom:

1. Four "right now" tiles queried inline with Prisma — today's sales, today's cash, held invoices, low stock. These are deliberately **not** scoped by the period filter below them: the till's headline numbers must not move when someone browses last year.
   - **Cash Received** is cash the shop *kept*: change is already netted off at save, so a 4000 bill paid with 5000 counts 4000. Cash refunded on today's net-return invoices is subtracted, not added (a second aggregate over `netBill < 0`). The rule is written up in [sales-checkout.md](sales-checkout.md) → *Cash tendered vs money kept*.
2. Quick Actions.
3. `<SalesProfitPanel>` — the filtered sales-and-profit section (client component). Its `cashReceived`/`cardAmount`/`bankAmount` totals are signed the same way.
4. Recent Invoices (number and customer link to the invoice page; *View all* → Reports) and Low Stock Alerts (*View inventory* → `/dashboard/purchases?tab=inventory&lowStock=1`).

## Sales & Profit panel

`components/dashboard/SalesProfitPanel.tsx` (client) + `components/dashboard/SalesProfitChart.tsx` (client) + `app/api/reports/dashboard/route.ts`.

**Filter** — the same `DateRangePreset` list as the Reports page (`lib/utils.ts` `getDateRangeForPreset`): today, yesterday, last 7 days, this month, last month, last 30 days, this year, last year, all, custom. The from/to inputs unlock only on `custom` and `all`. There is no Load button: `load` is a `useCallback` keyed on `{branchId, from, to}` and one effect refetches on any change, debounced 250 ms — same rule as Reports (see [orders.md](orders.md)). One filter row, above everything it scopes.

**`GET /api/reports/dashboard?branchId=&from=&to=`** returns:

```
{ granularity: "day" | "month",
  series: [{ key, sales, profit, cogs, invoices, expenses, netProfit }],
  totals: { invoiceCount, grossSale, discount, returnAmount,
            netSale, cogs, profit, marginPct,
            cashReceived, cardAmount, bankAmount,
            expenses, unpaidExpenses, withdrawals, injections,
            netProfit, netMarginPct } }
```

- `SAVED` invoices only (voided and held are excluded), matching the sales report's ACTIVE default.
- Buckets by **day** up to 92 days of range, by **month** beyond it. Every bucket in the range is emitted, so a day with no trade is a zero rather than a gap in the line. Keys are `YYYY-MM-DD` / `YYYY-MM` on the **shop's** calendar (`shopDateKey` / `shopMonthKey`) — the same convention `app/api/reports/cash/route.ts` groups by, so the two reports agree. They used to be the UTC date, which put every sale before 05:00 on the previous day and added an empty bucket at the front of every range (the window's `gte` is 19:00Z the day before). Month buckets step from the 1st, so a range starting on the 31st no longer skips February.
- `sales` is `netBill` (agrees with the Reports → Sales tab's Net Bill column; cross-checked against `/api/reports/sales` for the same range).

### Profit is an estimate — and knowingly so

`SaleInvoiceItem` stores **no cost snapshot**. COGS is therefore valued at the item's *current* `Item.purchasePrice`:

```
cogs   = Σ lines  (isReturn ? −1 : +1) × qty × item.purchasePrice
profit = netBill − cogs
```

Returns are netted out of cost as well as revenue — the goods went back on the shelf.

Consequence: **re-costing an item moves historical profit.** The UI carries this caveat under the chart (`dash_profitEstimateNote`). The real fix is a `costRate` column on `SaleInvoiceItem` written at checkout plus a backfill, and it should happen before these figures are used for anything official.

`creditApplied` does not enter the profit maths — store credit changes who pays, not what the goods cost or what they sold for.

### Gross vs net profit

`profit` / `marginPct` are the **trading margin**: sale minus cost of goods, nothing else. `netProfit` / `netMarginPct` take the period's recorded operating costs off it — see [expenses.md](expenses.md). Owner withdrawals are excluded from both: taking earnings out moves money without consuming anything, and netting them off would double-count money that has already left the cash balance.

Costs are **accrual** — a cost dated in the range counts whether or not it has been paid — and are bucketed by the cost's own `date`, never `paidAt`. The panel shows six tiles (Sales, Gross Profit, Costs, Net Profit, Margin, Discount) and both caveats sit under the chart.

### The chart

Hand-rolled inline SVG in `SalesProfitChart.tsx`; the project ships no charting dependency and this adds none.

- **Grouped columns**, Sales and *gross* Profit side by side per bucket, on **one** rupee axis. Bars cap at 24px wide with a 2px surface gap inside the pair, rounded 4px at the data end and square at the baseline; a negative profit hangs below the zero line with the rounding at the bottom. (Not candlesticks — those encode open/high/low/close and a sale bucket has no such four values.)
- Colours are slots 1 and 2 of a validated categorical palette — `#2a78d6` blue / `#eb6834` orange. The pair was checked against colour-vision-deficiency, normal-vision and contrast gates on a white surface before being used; don't swap them for brand teal/green without re-validating, and never for a red/green pair.
- Identity is never colour-alone: a legend is always rendered, the tooltip keys both series with a line swatch, and the **Show table** toggle renders the same numbers as a table.
- The whole band is the hit target, so nobody has to land on a thin bar; the hovered band takes a faint wash. Arrow keys move the selection and focus shows what hover shows.
- Y ticks are round numbers via `niceScale`, which spans negatives so a loss-making day plots below a marked zero line, and floors its step at 1 so a flat/zero period doesn't tick in fifths.
- X labels are thinned to `floor(innerW / 64)` slots so they never collide on a narrow screen; the axis band is inside the SVG's own height, so the card never grows a nested scrollbar.
- Costs and net profit are **not** plotted. A third series would need a third validated colour and would crowd bars already ~2.4px wide at 30 daily buckets; `expenses`/`netProfit` are optional on `SalesProfitPoint` and read by the table view instead.
- During a refetch the previous render is held at `opacity-50` — no skeleton, no layout jump.
- Bars thin out as the bucket count grows (~2.4px each at 30 daily buckets on a 420px-wide card, ~10px at 900px); the band hit target and the table view carry the reading at that density.

### Permissions

The endpoint is **not** permission-gated, matching every other read-only report route — see the rationale at the top of `lib/authz.ts` ("hiding figures from the staff standing at [the shared terminal] was never the goal"). Note that this does put cost and margin in front of a cashier, which `VIEW_PURCHASE_PRICE` withholds on the Items page. If that matters, gate `/api/reports/dashboard` on `VIEW_PURCHASE_PRICE` and hide the Profit / Margin tiles behind the same key client-side.

## Cost of goods and the sell unit

Net profit values cost of goods as `qty x Item.purchasePrice`. That is correct
only because **`purchasePrice` is always quoted per the unit the item is sold
in** — the GRN restates it whenever goods arrive in a different unit
(`units.md`).

If that ever stops being true, this is the figure that goes wrong first and
most quietly: cloth bought at Rs 90/gaz and sold by the metre would book cost
against the raw per-gaz rate and **overstate profit by 10%** on every line,
with nothing on screen to suggest it.

This is separate from the re-costing caveat already noted above (cost is valued
at the item's *current* purchase price, not the price it was bought at).
