// Clients-page formatters — ported 1:1 from mockups/clients.html.
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

export function fCr(n) { return Math.abs(n).toFixed(2) + ' Cr' }
export function fCr1(n) { return Math.abs(n).toFixed(1) + ' Cr' }

export function fL(inr) {
  const a = Math.abs(inr), s = inr < 0 ? '−' : ''
  if (a >= 1e7) return s + (a / 1e7).toFixed(2) + ' Cr'
  if (a >= 1e5) return s + (a / 1e5).toFixed(1) + ' L'
  return s + Math.round(a).toLocaleString('en-IN')
}

export function pctStr(n) { return n.toFixed(2) + '%' }

export function fDate(s) {
  if (!s) return '—'
  const d = new Date(s + 'T00:00:00')
  return d.getDate() + ' ' + MONTHS[d.getMonth()] + " '" + String(d.getFullYear()).slice(2)
}
export function fMonSh(s) {
  if (!s) return ''
  const d = new Date(s + 'T00:00:00')
  return MONTHS[d.getMonth()] + " '" + String(d.getFullYear()).slice(2)
}
