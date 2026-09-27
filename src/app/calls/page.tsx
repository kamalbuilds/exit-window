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
  rows?: number | null;
  requestSummary?: Record<string, unknown>;
}

interface CallsPayload {
  summary: {
    network: number;
    hits: number;
    first: string | null;
    last: string | null;
    successRate: number;
    rows?: number;
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

/** Public proof of every Nansen API call this product made, read from the committed call log. */
export default function CallsPage() {
  const { data, error, loading, refresh } = usePoll<CallsPayload>("/api/calls", 30_000);
  const s = data?.summary;
  const maxEp = s ? Math.max(1, ...s.byEndpoint.map((e) => e.network + e.hits)) : 1;

  return (
    <main className="px-4 lg:px-8 py-6 max-w-[1440px] w-full">
      <h1 className="display text-[24px]">Nansen API calls</h1>
      <p className="mt-1 text-ink-2">Every request this product made to the Nansen API, by endpoint, with status and latency.</p>

      {error ? (
        <div className="mt-6">
          <ErrorState message={`The call log did not load (${error}).`} onRetry={refresh} />
        </div>
      ) : loading && !data ? (
        <div className="mt-6">
          <LoadingRows label="call log" rows={6} />
        </div>
      ) : data && s ? (
        <>
          <section aria-label="Call totals" className="panel mt-6 px-5 py-4">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
              <div>
                <dt className="label">Nansen API calls</dt>
                <dd className="fig mt-1 text-[20px] text-ink">{s.network}</dd>
              </div>
              <div>
                <dt className="label">Requests served</dt>
                <dd className="fig mt-1 text-[20px] text-ink">{s.network + s.hits}</dd>
              </div>
              <div>
                <dt className="label">Rows of Nansen data</dt>
                <dd className="fig mt-1 text-[20px] text-ink">{(s.rows ?? 0).toLocaleString()}</dd>
              </div>
              <div>
                <dt className="label">Endpoints</dt>
                <dd className="fig mt-1 text-[20px] text-ink">{s.byEndpoint.length}</dd>
              </div>
            </dl>
          </section>

          <div className="mt-6 grid items-start gap-6 xl:grid-cols-2">
            <section aria-label="Calls by endpoint" className="panel p-5">
              <h2 className="display text-[16px]">By endpoint</h2>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[420px] table-fixed text-left">
                  <colgroup>
                    <col />
                    <col className="w-14" />
                    <col className="w-16" />
                    <col className="w-28" />
                  </colgroup>
                  <thead>
                    <tr className="bg-bezel">
                      <th scope="col" className="label py-2 pl-3 pr-2 font-medium">
                        Endpoint
                      </th>
                      <th scope="col" className="label py-2 px-2 font-medium text-right">
                        Calls
                      </th>
                      <th scope="col" className="label py-2 px-2 font-medium text-right">
                        Served
                      </th>
                      <th scope="col" className="label py-2 pl-2 pr-3 font-medium text-right">
                        Share
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.byEndpoint.map((e) => (
                      <tr
                        key={e.endpoint}
                        className="border-b border-rule transition-[background-color] duration-150 last:border-b-0 hover:bg-bezel"
                      >
                        <td className="py-2.5 pl-3 pr-2">
                          <span className="fig block truncate text-[13px] text-ink">{e.endpoint}</span>
                        </td>
                        <td className="fig whitespace-nowrap py-2.5 px-2 text-right text-[13px] text-ink-2">
                          {e.network}
                        </td>
                        <td className="fig whitespace-nowrap py-2.5 px-2 text-right text-[13px] text-ink-2">
                          {e.network + e.hits}
                        </td>
                        <td className="py-2.5 pl-2 pr-3">
                          <span
                            className="ml-auto flex h-1 w-24 overflow-hidden rounded-full bg-bezel"
                            role="img"
                            aria-label={`${e.network} calls, ${e.network + e.hits} requests served`}
                          >
                            <span className="h-full bg-lume" style={{ width: `${(e.network / maxEp) * 100}%` }} />
                            <span className="h-full bg-rule" style={{ width: `${(e.hits / maxEp) * 100}%` }} />
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {s.first && s.last && (
                <p className="mt-4 text-[13px] text-ink-3">
                  From <span className="fig">{s.first.replace("T", " ").slice(0, 19)}</span> to{" "}
                  <span className="fig">{s.last.replace("T", " ").slice(0, 19)}</span> UTC.
                </p>
              )}
            </section>

            <section aria-label="Latest calls" className="panel p-5">
              <h2 className="display text-[16px]">Latest calls</h2>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[560px] text-left">
                  <thead>
                    <tr className="bg-bezel">
                      <th scope="col" className="label whitespace-nowrap py-2 pl-3 pr-2 font-medium">
                        Time
                      </th>
                      <th scope="col" className="label py-2 px-2 font-medium">
                        Endpoint
                      </th>
                      <th scope="col" className="label py-2 px-2 font-medium">
                        Request
                      </th>
                      <th scope="col" className="label py-2 pl-2 pr-3 font-medium text-right">
                        Result
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent.filter((c) => c.cache !== "hit").map((c, i) => (
                      <tr
                        key={`${c.ts}-${i}`}
                        className="border-b border-rule transition-[background-color] duration-150 last:border-b-0 hover:bg-bezel"
                      >
                        <td className="fig whitespace-nowrap py-2.5 pl-3 pr-2 text-[12px] text-ink-3">
                          {c.ts.slice(11, 19)}
                        </td>
                        <td className="py-2.5 px-2 pr-3">
                          <span className="fig block max-w-[180px] truncate text-[13px] text-ink">{c.endpoint}</span>
                        </td>
                        <td className="py-2.5 px-2 pr-3">
                          <span className="fig block max-w-[180px] truncate text-[12px] text-ink-2">
                            {describe(c.requestSummary)}
                          </span>
                        </td>
                        <td className="whitespace-nowrap py-2.5 pl-2 pr-3 text-right">
                          {c.cache === "hit" ? (
                            <span className="chip chip-mute fig">cache {c.source ?? "disk"}</span>
                          ) : (
                            <span
                              className={`chip fig ${
                                c.status === 0 || (c.status ?? 0) >= 400 ? "chip-late" : "chip-lume"
                              }`}
                            >
                              {c.status === 0 ? "timeout" : (c.status ?? "")}
                              {c.rows !== undefined && c.rows !== null ? ` · ${c.rows} rows` : ""}{" "}
                              {c.latencyMs !== undefined ? ` · ${c.latencyMs}ms` : ""}
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
        </>
      ) : null}
    </main>
  );
}
