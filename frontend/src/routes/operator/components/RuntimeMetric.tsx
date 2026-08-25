function RuntimeMetric({
  label,
  value,
  emphasis = false,
}: {
  label: string
  value: string
  emphasis?: boolean
}) {
  const isLongValue = value.length > 28
  const valueClassName = [
    "mt-2 min-w-0 text-foreground",
    emphasis && !isLongValue ? "text-base font-semibold" : "text-sm font-medium",
    isLongValue
      ? "break-all font-mono text-xs leading-5 tracking-[-0.02em]"
      : "break-words",
  ].join(" ")

  return (
    <div className="min-w-0 rounded-2xl border border-white/8 bg-white/3 p-3">
      <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </div>
      <div className={valueClassName} title={value}>
        {value}
      </div>
    </div>
  )
}

export default RuntimeMetric
