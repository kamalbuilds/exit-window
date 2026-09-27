// Shape of GET /api/status is not in src/lib/types.ts yet; read every plausible
// field name defensively and default to "paper" (never claim live without a
// clear signal - this gates a real money mirror path).
export interface StatusPayload {
  live?: boolean;
  liveMirroringEnabled?: boolean;
  mode?: "paper" | "live";
  [key: string]: unknown;
}

export function isLiveEnabled(status: StatusPayload | null): boolean {
  if (!status) return false;
  return status.mode === "live" || status.live === true || status.liveMirroringEnabled === true;
}

export function StatusBadge({ status }: { status: StatusPayload | null }) {
  const live = isLiveEnabled(status);
  return (
    <span
      className="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded-[2px] border num"
      style={{
        color: live ? "var(--red)" : "var(--green)",
        borderColor: live ? "var(--red-dim)" : "var(--green-dim)",
      }}
      title={live ? "Mirror orders execute for real on Hyperliquid" : "Mirror orders are recorded, not sent"}
    >
      {live ? "live" : "paper"}
    </span>
  );
}
