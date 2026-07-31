function RuntimeMetric({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="rounded-xl border border-emerald-950/10 bg-white/74 p-3">
      <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 text-sm font-semibold tracking-[-0.01em] text-foreground">
        {value}
      </div>
    </div>
  )
}

export default RuntimeMetric
