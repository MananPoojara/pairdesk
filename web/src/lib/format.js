// Money/date formatters — ported 1:1 from mockups/dashboard-r4.html so numbers match exactly.

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

export function fmtInr(n) {
  const a = Math.abs(n), s = n < 0 ? '-' : '+'
  if (a >= 1e7) return s + '₹' + (a / 1e7).toFixed(1) + 'Cr'
  if (a >= 1e5) return s + '₹' + (a / 1e5).toFixed(1) + 'L'
  return s + '₹' + Math.round(a).toLocaleString('en-IN')
}

export function fmtCr(cr) {
  return '₹' + cr.toFixed(1) + 'Cr'
}

export function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' +
    (d.getUTCFullYear() % 100).toString().padStart(2, '0')
}

export function fmtNum(n, dp = 2) {
  return Number(n).toLocaleString('en-IN', { minimumFractionDigits: dp, maximumFractionDigits: dp })
}

// signed percent, e.g. +45.29%
export function fmtPct(n, dp = 2) {
  return (n >= 0 ? '+' : '') + Number(n).toFixed(dp) + '%'
}
