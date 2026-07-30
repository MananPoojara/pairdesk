export const MARGIN_RATE = 0.12

export function marginFromExposureCr(exposureCr) {
  const exposure = Number(exposureCr)
  return Number.isFinite(exposure) && exposure > 0 ? exposure * MARGIN_RATE : 0
}

export function truncateOneDecimal(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  const truncated = Math.trunc(n * 10) / 10
  return Object.is(truncated, -0) ? 0 : truncated
}

export function formatMonthlyReturn(value) {
  return `${truncateOneDecimal(value).toFixed(1)}%`
}
