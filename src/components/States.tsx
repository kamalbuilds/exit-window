// Loading, empty and error states, written as sentences (DESIGN.md: States).

export function LoadingRows({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-2">
      <span className="sr-only">Loading {label}</span>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-9 shimmer rounded-[var(--radius-control)]" style={{ opacity: 1 - i * 0.14 }} />
      ))}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="border-t border-b border-rule py-6">
      <p className="text-ink-2">{title}</p>
      {hint ? <p className="mt-1 text-[14px] text-ink-3">{hint}</p> : null}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="bg-late-wash border-t-2 border-late px-4 py-4 flex items-center justify-between gap-4">
      <p className="text-[14px] text-ink">{message}</p>
      {onRetry ? (
        <button
          onClick={onRetry}
          className="h-9 px-3 border border-ink text-[13px] rounded-[var(--radius-control)] shrink-0 transition-[background-color] duration-150 hover:bg-bezel"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}
