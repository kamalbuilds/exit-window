// Real designed states for loading / empty / error, shared across panels.

export function LoadingRows({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-2">
      <p className="text-xs uppercase tracking-widest text-fg-faint num">{label}</p>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-10 rounded-sm border border-line bg-[var(--bg-raised)] animate-pulse"
          style={{ opacity: 1 - i * 0.18 }}
        />
      ))}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="border border-dashed border-line rounded-sm px-4 py-6 text-center">
      <p className="text-fg-dim">{title}</p>
      {hint ? <p className="mt-1 text-sm text-fg-faint">{hint}</p> : null}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="border border-[color:var(--red)]/40 bg-[var(--red-dim)] rounded-sm px-4 py-4 flex items-center justify-between gap-4">
      <p className="text-sm text-fg">{message}</p>
      {onRetry ? (
        <button
          onClick={onRetry}
          className="text-xs uppercase tracking-widest border border-line px-2 py-1 rounded-sm hover:border-line-strong shrink-0"
        >
          retry
        </button>
      ) : null}
    </div>
  );
}
