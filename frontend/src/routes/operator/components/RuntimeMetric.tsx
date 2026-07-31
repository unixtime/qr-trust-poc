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
    <div className="min-w-0 rounded-[1.2rem] border border-border/80 bg-background/90 p-3">
      <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </div>
      <div className={valueClassName} title={value}>
        {value}
      </div>
    </div>
  )
}

export default RuntimeMetric
