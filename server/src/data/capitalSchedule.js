// A client's capital timeline, built from pay-in / pay-out events. Capital is a step function of
// time (running balance of signed events); exposure = capital × leverage; the book's per-client
// scale = exposure / 30 (the blueprint notional). Capital changes align to trade-cycle boundaries —
// the book re-sizes at the next re-entry on/after the event date (see buildClientBook), and returns
// re-base by period via a NAV series (see clients.js). Leverage is treated as constant over time.

const D = (s) => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, d) }

// events: [{ effective_date:'YYYY-MM-DD', type:'PAY_IN'|'PAY_OUT', amount_cr }] (any order).
// Returns step points + capitalAt/exposureAt/scaleAt(dateISO) and periodCapital(monthISO) helpers.
export function capitalSchedule(events, leverage, base = 30) {
  const evs = [...events]
    .map(e => ({ t: D(e.effective_date), date: String(e.effective_date).slice(0, 10),
                 signed: (e.type === 'PAY_OUT' ? -1 : 1) * Number(e.amount_cr) }))
    .sort((a, b) => a.t - b.t)

  // Collapse to running-balance step points (multiple events on one day → that day's final balance).
  const steps = []
  let bal = 0
  for (const e of evs) {
    bal += e.signed
    const last = steps[steps.length - 1]
    if (last && last.t === e.t) last.capital = bal
    else steps.push({ t: e.t, date: e.date, capital: bal })
  }

  const capitalAt = (dateISO) => {
    const t = D(dateISO)
    let cap = 0
    for (const s of steps) { if (s.t <= t) cap = s.capital; else break }
    return cap
  }
  const exposureAt = (dateISO) => capitalAt(dateISO) * leverage
  const scaleAt = (dateISO) => exposureAt(dateISO) / base

  return { steps, capitalAt, exposureAt, scaleAt }
}

// ── self-check ──────────────────────────────────────────────────────────────
export function demo() {
  const assert = (c, m) => { if (!c) throw new Error('capitalSchedule demo: ' + m) }
  // Ashford: 25 Cr at join, +25 Cr top-up on 2025-06-05, leverage 2.
  const s = capitalSchedule([
    { effective_date: '2024-04-02', type: 'PAY_IN', amount_cr: 25 },
    { effective_date: '2025-06-05', type: 'PAY_IN', amount_cr: 25 },
  ], 2)
  assert(s.capitalAt('2024-04-01') === 0, 'before join = 0')
  assert(s.capitalAt('2024-04-02') === 25, 'at join = 25')
  assert(s.capitalAt('2025-06-04') === 25, 'day before top-up = 25')
  assert(s.capitalAt('2025-06-05') === 50, 'at top-up = 50')
  assert(s.capitalAt('2026-07-01') === 50, 'after = 50')
  assert(Math.abs(s.scaleAt('2024-05-01') - 50 / 30) < 1e-9, 'scale before = 50/30')
  assert(Math.abs(s.scaleAt('2025-07-01') - 100 / 30) < 1e-9, 'scale after = 100/30')
  // Pay-out steps capital down.
  const p = capitalSchedule([
    { effective_date: '2024-01-10', type: 'PAY_IN', amount_cr: 10 },
    { effective_date: '2025-01-10', type: 'PAY_OUT', amount_cr: 4 },
  ], 1)
  assert(p.capitalAt('2024-06-01') === 10, 'payout: before = 10')
  assert(p.capitalAt('2025-06-01') === 6, 'payout: after = 6')
  return 'ok'
}

if (process.argv[1] && process.argv[1].endsWith('capitalSchedule.js')) console.log(demo())
