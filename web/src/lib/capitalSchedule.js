// Client capital timeline from pay-in / pay-out events — mirror of server/src/data/capitalSchedule.js.
// capitalAt/exposureAt/scaleAt(dateISO) are step functions; leverage is treated as constant.

const D = (s) => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, d) }

// events: [{ effective_date:'YYYY-MM-DD', type:'PAY_IN'|'PAY_OUT', amount_cr }] (any order).
export function capitalSchedule(events, leverage, base = 30) {
  const evs = [...(events || [])]
    .map(e => ({ t: D(e.effective_date), signed: (e.type === 'PAY_OUT' ? -1 : 1) * Number(e.amount_cr) }))
    .sort((a, b) => a.t - b.t)

  const steps = []
  let bal = 0
  for (const e of evs) {
    bal += e.signed
    const last = steps[steps.length - 1]
    if (last && last.t === e.t) last.capital = bal
    else steps.push({ t: e.t, capital: bal })
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
