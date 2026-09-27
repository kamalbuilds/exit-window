// Loading, empty and error states, written as sentences (DESIGN.md: States).

import type { ReactNode } from "react";

export function LoadingRows({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="flex flex-col gap-2">
      <span className="sr-only">Loading {label}</span>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          aria-hidden="true"
          className="h-11 shimmer rounded-[var(--radius-control)]"
          style={{ opacity: 1 - i * 0.12 }}
        />
      ))}
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="panel px-5 py-6">
      <p className="text-[14px] text-ink-2">{title}</p>
      {hint ? <p className="mt-1 text-[13px] text-ink-3">{hint}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="px-5 py-4 flex items-center justify-between gap-4 rounded-[var(--radius-panel)] border border-late bg-late-wash"
    >
      <p className="text-[14px] text-ink">{message}</p>
      {onRetry ? (
        <button onClick={onRetry} className="btn-secondary h-9 px-4 text-[13px] font-medium shrink-0 whitespace-nowrap active:scale-[0.97]">
          Try again
        </button>
      ) : null}
    </div>
  );
}
