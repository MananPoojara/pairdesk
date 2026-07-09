const PRESETS = ['1M', '3M', '1Y', 'All']

export default function DateRangeControl({
  range,
  startDate,
  endDate,
  minDate,
  maxDate,
  onPreset,
  onStartDate,
  onEndDate,
}) {
  return (
    <div className="rng date-rng">
      {PRESETS.map(r => (
        <button key={r} className={r === range ? 'on' : undefined} onClick={() => onPreset(r)}>{r}</button>
      ))}
      <span className="date-fields">
        <input
          aria-label="Start date"
          type="date"
          min={minDate || undefined}
          max={endDate || maxDate || undefined}
          value={startDate || ''}
          onChange={e => onStartDate(e.target.value)}
        />
        <span className="date-arrow">→</span>
        <input
          aria-label="End date"
          type="date"
          min={startDate || minDate || undefined}
          max={maxDate || undefined}
          value={endDate || ''}
          onChange={e => onEndDate(e.target.value)}
        />
      </span>
    </div>
  )
}
