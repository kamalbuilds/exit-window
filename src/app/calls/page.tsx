"use client";

import { ErrorState, LoadingRows } from "@/components/States";
import { usePoll } from "@/components/usePoll";

interface CallLine {
  ts: string;
  endpoint: string;
  cache: "miss" | "hit";
  source?: "memory" | "disk" | "seed";
  status?: number;
  latencyMs?: number;
  rows?: number;
  requestSummary?: Record<string, unknown>;
}

interface CallsPayload {
  summary: {
    network: number;
    hits: number;
    first: string | null;
    last: string | null;
    successRate: number;
    byEndpoint: { endpoint: string; network: number; hits: number }[];
  };
  recent: CallLine[];
}

function describe(r?: Record<string, unknown>): string {
  if (!r) return "";
  const parts: string[] = [];
  if (typeof r.address === "string") parts.push(`${r.address.slice(0, 6)}…${r.address.slice(-4)}`);
  if (typeof r.coin === "string") parts.push(r.coin);
  if (typeof r.token_symbol === "string") parts.push(r.token_symbol);
  if (r.page !== undefined) parts.push(`page ${String(r.page)}`);
  if (r.lookbackHours !== undefined) parts.push(`${String(r.lookbackHours)}h`);
  return parts.join(" · ");
}

/** Public proof of every Nansen API call this project made, read from the committed call log. */
export default function CallsPage() {
  const { data, error, loading, refresh } = usePoll<CallsPayload>("/api/calls", 30_000);
  const s = data?.summary;
  const maxEp = s ? Math.max(1, ...s.byEndpoint.map((e) => e.network + e.hits)) : 1;

  return (
    <main className="mx-auto w-full max-w-[1320px] px-4 sm:px-8 flex-1 pb-16">
      <header className="pt-10 pb-8 border-b border-ink grid grid-cols-[minmax(0,1fr)] lg:grid-cols-12 gap-8 items-end">
        <div className="lg:col-span-7">
          <h1 className="display text-[clamp(34px,5vw,56px)]">Every Nansen call this product made.</h1>
          <p className="mt-4 text-[17px] text-ink-2 max-w-[60ch]">
            Appended by the server on every request to the Nansen API and committed to the repository as{" "}
            <span className="fig text-[15px]">data/nansen-calls.jsonl</span>. Cache hits are listed too, so you can see what was
            paid for once and reused. No key or header value is ever written.
          </p>
        </div>
        {s && (
          <dl className="lg:col-span-5 grid grid-cols-3 gap-6 border-t border-ink pt-4">
            <div>
              <dt className="label">Paid calls</dt>
              <dd className="display text-[40px] mt-1">{s.network}</dd>
            </div>
            <div>
              <dt className="label">Served from cache</dt>
              <dd className="display text-[40px] mt-1">{s.hits}</dd>
            </div>
            <div>
              <dt className="label">Success</dt>
              <dd className="display text-[40px] mt-1">{Math.round(s.successRate)}%</dd>
            </div>
          </dl>
        )}
      </header>

      {error ? (
        <div className="mt-8">
          <ErrorState message={`The call log did not load (${error}).`} onRetry={refresh} />
        </div>
      ) : loading && !data ? (
        <div className="mt-8">
          <LoadingRows label="call log" rows={6} />
        </div>
      ) : data ? (
        <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-12 gap-x-12 gap-y-10 pt-10">
          <section className="lg:col-span-5">
            <h2 className="display text-[26px] mb-4">By endpoint</h2>
            <ol className="border-t border-ink">
              {data.summary.byEndpoint.map((e) => (
                <li key={e.endpoint} className="py-3 border-b border-rule">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="fig text-[13px] text-ink truncate">{e.endpoint}</span>
                    <span className="fig text-[13px] text-ink-2 whitespace-nowrap">
                      {e.network} paid · {e.hits} cached
                    </span>
                  </div>
                  <div className="mt-2 h-2 flex bg-bezel" aria-hidden="true">
                    <span className="h-full bg-ink" style={{ width: `${(e.network / maxEp) * 100}%` }} />
                    <span className="h-full bg-window" style={{ width: `${(e.hits / maxEp) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ol>
            {data.summary.first && data.summary.last && (
              <p className="mt-4 text-[13px] text-ink-3">
                From <span className="fig">{data.summary.first.replace("T", " ").slice(0, 19)}</span> to{" "}
                <span className="fig">{data.summary.last.replace("T", " ").slice(0, 19)}</span> UTC.
              </p>
            )}
          </section>

          <section className="lg:col-span-7 min-w-0">
            <h2 className="display text-[26px] mb-4">Latest calls</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left">
                <thead>
                  <tr className="border-t border-b border-ink label">
                    <th className="py-2 font-medium">Time (UTC)</th>
                    <th className="py-2 font-medium">Endpoint</th>
                    <th className="py-2 font-medium">Request</th>
                    <th className="py-2 font-medium text-right">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((c, i) => (
                    <tr key={`${c.ts}-${i}`} className="border-b border-rule align-baseline">
                      <td className="py-2 fig text-[12px] text-ink-3 whitespace-nowrap">{c.ts.slice(11, 19)}</td>
                      <td className="py-2 fig text-[12px] text-ink pr-3">{c.endpoint}</td>
                      <td className="py-2 fig text-[12px] text-ink-2 pr-3">{describe(c.requestSummary)}</td>
                      <td className="py-2 fig text-[12px] text-right whitespace-nowrap">
                        {c.cache === "hit" ? (
                          <span className="text-ink-3">cache {c.source ?? ""}</span>
                        ) : (
                          <span className={c.status && c.status >= 400 ? "text-late" : "text-lume"}>
                            {c.status ?? ""} {c.rows !== undefined ? `· ${c.rows} rows` : ""} {c.latencyMs !== undefined ? `· ${c.latencyMs}ms` : ""}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
