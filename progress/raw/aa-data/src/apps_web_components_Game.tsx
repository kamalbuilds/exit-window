"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { CLASS_INFO, DECK_CLASSES, normalizeSeed, type Card, type CardFace, type Call, type LabelClass } from "@labelme/core/browser";
import type { RoundPayload, Answer } from "@/lib/deck";
import { WalletCard } from "./WalletCard";
import { NansenRail, cap, landCall, replayRows, rowFromStart, type RailRow } from "./NansenRail";

type Reveal = Answer & { correct: boolean | null };
type Phase = "idle" | "loading" | "play" | "done" | "draw";
type Guessed = { id: string; guess: LabelClass; reveal: Reveal };

const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function Game({
  initialRound,
  idleChildren,
  exampleCalls,
  exampleRecordedAt,
}: {
  initialRound?: RoundPayload;
  idleChildren?: React.ReactNode;
  /** the example card's four recorded calls, replayed server-side through the engine — the rail on load (replayed · 0 cr) */
  exampleCalls?: Call[];
  exampleRecordedAt?: string;
}) {
  const [phase, setPhase] = useState<Phase>(initialRound ? "play" : "idle");
  const [seedInput, setSeedInput] = useState("");
  const [round, setRound] = useState<RoundPayload | undefined>(initialRound);
  const [i, setI] = useState(0);
  const [guessed, setGuessed] = useState<Guessed[]>([]);
  const [pending, setPending] = useState<LabelClass | undefined>();
  const [reveal, setReveal] = useState<Reveal | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [status, setStatus] = useState("");
  const [toast, setToast] = useState<string | undefined>();
  // the Nansen call rail: every call this page made, in order; a "run" = one replay / reveal / live draw
  const [rail, setRail] = useState<RailRow[]>(() => (exampleCalls?.length ? replayRows(0, exampleCalls, exampleRecordedAt) : []));
  const [currentRun, setCurrentRun] = useState(0);
  const runRef = useRef(0);
  const newRun = () => {
    const run = ++runRef.current;
    setCurrentRun(run);
    return run;
  };
  /** the receipt: the current run's rows — the drawer prints exactly these */
  const receipt = rail.filter((r) => r.run === currentRun);
  const rows = receipt.filter((r) => r.call).map((r) => r.call!);
  const receiptReplayed = receipt.length > 0 && receipt.every((r) => r.origin === "replayed");
  // live draw
  const [drawCardState, setDrawCard] = useState<Card | undefined>();
  const [drawGuess, setDrawGuess] = useState<LabelClass | undefined>();
  const [drawHouse, setDrawHouse] = useState<{ guess: LabelClass; because: string; credits: number; calls: number; ms: number } | undefined>();
  const [drawReplay, setDrawReplay] = useState<string | undefined>();
  const [drawBusy, setDrawBusy] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const abortRef = useRef<AbortController | undefined>(undefined);
  // where "Back" from a draw returns to: the round in progress, the score card, or the idle home
  const [returnPhase, setReturnPhase] = useState<Phase>(initialRound ? "play" : "idle");
  const phaseRef = useRef<Phase>(phase);
  phaseRef.current = phase;

  const current: CardFace | undefined = round?.cards[i];
  const correct = guessed.filter((g) => g.reveal.correct).length;
  const streak = (() => {
    let s = 0;
    for (let k = guessed.length - 1; k >= 0; k--) {
      if (guessed[k].reveal.correct) s++;
      else break;
    }
    return s;
  })();

  const start = useCallback(async (seed: string) => {
    setPhase("loading");
    setError(undefined);
    setStatus("Dealing ten cards from the recorded deck…");
    try {
      const res = await fetch(`/api/round?seed=${encodeURIComponent(normalizeSeed(seed))}`);
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      const r = (await res.json()) as RoundPayload;
      setRound(r);
      setI(0);
      setGuessed([]);
      setReveal(undefined);
      setPending(undefined);
      setPhase("play");
      setStatus("");
      window.history.replaceState(null, "", `/r/${r.seed}`);
    } catch (e) {
      setPhase("idle");
      setStatus("");
      setError((e as Error).message);
    }
  }, []);

  const guess = useCallback(
    async (cls: LabelClass) => {
      if (!current || reveal || pending) return;
      setPending(cls);
      try {
        const res = await fetch(`/api/reveal?id=${current.id}&guess=${cls}`);
        if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
        const a = (await res.json()) as Reveal;
        setReveal(a);
        setGuessed((g) => [...g, { id: current.id, guess: cls, reveal: a }]);
        // the reveal is also the receipt: the four recorded calls behind this card land in the rail, replayed at 0 credits
        if (a.calls?.length) {
          const run = newRun();
          setRail((r) => cap([...r, ...replayRows(run, a.calls, a.recordedAt)]));
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setPending(undefined);
      }
    },
    [current, reveal, pending],
  );

  const next = useCallback(() => {
    if (!round) return;
    if (i + 1 >= round.cards.length) {
      setPhase("done");
      window.history.replaceState(null, "", `/r/${round.seed}?score=${correct}`);
    } else {
      setI(i + 1);
      setReveal(undefined);
    }
  }, [round, i, correct]);

  const draw = useCallback(async (cls?: LabelClass) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    if (phaseRef.current !== "draw") setReturnPhase(phaseRef.current === "loading" ? "idle" : phaseRef.current);
    setPhase("draw");
    const run = newRun();
    let origin: RailRow["origin"] = "live";
    let recordedAt: string | undefined;
    setDrawCard(undefined);
    setDrawGuess(undefined);
    setDrawHouse(undefined);
    setDrawReplay(undefined);
    setError(undefined);
    setDrawBusy(true);
    setStatus("Asking Nansen for an unseen labelled wallet…");
    try {
      const res = await fetch(`/api/draw${cls ? `?class=${cls}` : ""}`, { method: "POST", signal: ctrl.signal });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({ error: `HTTP ${res.status}` }))).error ?? `HTTP ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let gotCard = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          const e = JSON.parse(line);
          if (e.type === "start") setRail((r) => cap([...r, rowFromStart(run, e.start)]));
          else if (e.type === "call") setRail((r) => landCall(r, run, e.call, origin, recordedAt));
          else if (e.type === "picked")
            setStatus(`Picked one of ${e.candidates} unseen ${CLASS_INFO[e.class as LabelClass].name} wallets on ${e.token} — pulling its clues…`);
          else if (e.type === "replay") {
            origin = "replayed";
            setDrawReplay(e.message);
          } else if (e.type === "card") {
            gotCard = true;
            recordedAt = e.card?.recordedAt;
            // the replayed rows landed before the card: stamp them with the fixture date now
            if (origin === "replayed" && recordedAt) setRail((r) => r.map((x) => (x.run === run && !x.recordedAt ? { ...x, recordedAt } : x)));
            setDrawCard(e.card);
            setStatus("");
          } else if (e.type === "house") setDrawHouse(e);
          else if (e.type === "error") throw new Error(e.message);
        }
      }
      // REGRESSION (review pass 1): a stream that ended without a card left the page blank — say so
      if (!gotCard) setError("Nansen busy — try again (the draw ended without a card)");
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(`Nansen busy — try again (${(e as Error).message.slice(0, 120)})`);
    } finally {
      // REGRESSION (review pass 1): only the draw that is still current may clear the busy flag and status —
      // an aborted earlier draw must not wipe the new one's "Asking Nansen…" line
      if (abortRef.current === ctrl) {
        setDrawBusy(false);
        setStatus("");
      }
    }
  }, []);

  // the Example section (a server component) asks for the live run through a DOM event
  useEffect(() => {
    const onLive = () => draw();
    window.addEventListener("labelme:draw", onLive);
    return () => window.removeEventListener("labelme:draw", onLive);
  }, [draw]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.target instanceof HTMLInputElement || ev.target instanceof HTMLTextAreaElement) return;
      // REGRESSION (audit 2026-09-19): a focused button owns Enter/Space only — after clicking "the recorded round" chip the
      // focus sits on that button and keys 1–5 went dead until the player clicked elsewhere
      if (ev.target instanceof HTMLButtonElement && (ev.key === "Enter" || ev.key === " ")) return;
      const n = Number(ev.key);
      if (n >= 1 && n <= DECK_CLASSES.length) {
        if (phase === "play" && !reveal) guess(DECK_CLASSES[n - 1]);
        if (phase === "draw" && drawCardState && !drawGuess) setDrawGuess(DECK_CLASSES[n - 1]);
      }
      if ((ev.key === "Enter" || ev.key === "n") && phase === "play" && reveal) next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, reveal, guess, next, drawCardState, drawGuess]);

  const share = async () => {
    const url = `${window.location.origin}/r/${round?.seed}?score=${correct}`;
    try {
      await navigator.clipboard.writeText(url);
      setToast("Link copied");
    } catch {
      setToast(url);
    }
    setTimeout(() => setToast(undefined), 2200);
  };

  const chips = (onPick: (c: LabelClass) => void, picked?: LabelClass, truth?: LabelClass, disabled = false) => (
    <div className="chips choices" role="group" aria-label="your guess">
      {DECK_CLASSES.map((k, n) => {
        const isTruth = truth === k;
        const isPick = picked === k;
        const cls = ["chip", isTruth ? "truth" : "", isPick && !isTruth ? "miss" : "", isPick ? "on" : ""].filter(Boolean).join(" ");
        return (
          <button
            key={k}
            type="button"
            className={cls}
            onClick={() => onPick(k)}
            disabled={disabled || !!picked}
            aria-pressed={isPick}
            title={`press ${n + 1}`}
          >
            <kbd>{n + 1}</kbd> {CLASS_INFO[k].name}
          </button>
        );
      })}
    </div>
  );

  const revealPanel = (
    a: Pick<Reveal, "class" | "nansenLabel" | "entity" | "address" | "tell" | "source" | "recordedAt">,
    picked: LabelClass | undefined,
    live: boolean,
  ) => {
    const ok = picked === a.class;
    return (
      <div className={`reveal ${ok ? "ok" : "miss"}`} role="status" aria-live="polite">
        <div className="reveal-head">
          <span className={`badge ${ok ? "real" : "impostor"}`}>{ok ? "correct" : `you said ${picked ? CLASS_INFO[picked].name : "—"}`}</span>
          <b className="reveal-class" style={{ color: CLASS_INFO[a.class].hue }}>
            {CLASS_INFO[a.class].name}
          </b>
          {a.entity && <span className="reveal-entity">{a.entity}</span>}
          {a.nansenLabel && <span className="fact">tag “{a.nansenLabel}”</span>}
          {a.source.labelType === "exchange" && a.class !== "exchange" && <span className="fact">in Nansen&apos;s Exchange group</span>}
        </div>
        <p className="tell">{a.tell}</p>
        <p className="provenance">
          <span className="mono">{a.address}</span> · Nansen said so via <code>{a.source.endpoint}</code>
          {a.source.labelType ? <code>label_type={a.source.labelType}</code> : null}
          {a.source.token ? ` on ${a.source.token}` : ""} · {live ? "live, just now" : `recorded ${a.recordedAt.slice(0, 10)}`}
        </p>
      </div>
    );
  };

  return (
    <>
      <header className="hero">
        <h1>
          Can you read a <span className="real">wallet</span>?
        </h1>
        <p>Ten real ethereum wallets, four Nansen clues each. Guess the label. The reveal teaches the tell.</p>
      </header>

      <div className="panel">
        <form
          className="search"
          onSubmit={(e) => {
            e.preventDefault();
            start(seedInput);
          }}
        >
          <input
            value={seedInput}
            onChange={(e) => setSeedInput(e.target.value)}
            placeholder="seed — leave empty for a random round"
            aria-label="round seed (optional)"
            maxLength={32}
            autoComplete="off"
          />
          <button type="submit" disabled={phase === "loading"}>
            {phase === "idle" || phase === "loading" ? "Deal" : "Deal again"}
          </button>
        </form>
        <div className="chips" role="group" aria-label="quick starts">
          <button type="button" className="chip" onClick={() => start("meridian1933")}>
            the recorded round · meridian1933
          </button>
          <button type="button" className="chip" onClick={() => draw()} disabled={drawBusy}>
            Draw fresh · live · 13 credits
          </button>
          {round && phase !== "play" && (
            <button type="button" className="chip" onClick={() => start(round.seed)}>
              replay round {round.seed}
            </button>
          )}
        </div>
      </div>

      <p className="status" aria-live="polite">
        {phase === "draw" && drawBusy ? "" : status}
      </p>
      {error && (
        <div className="banner err" role="alert">
          {error}
          <small>The default round never touches the network — only “Draw fresh” does.</small>
        </div>
      )}

      {phase === "play" && round && current && (
        <section className="round" aria-label="the round">
          <div className="progress-dots" aria-label={`card ${i + 1} of ${round.cards.length}`}>
            {round.cards.map((c, k) => {
              const g = guessed.find((x) => x.id === c.id);
              return <i key={c.id} className={k === i ? "now" : g ? (g.reveal.correct ? "ok" : "miss") : ""} />;
            })}
            <span className="dots-text">
              {correct}/{guessed.length} right{streak > 1 ? ` · streak ${streak}` : ""}
            </span>
          </div>
          <WalletCard clues={current.clues} title={`Wallet ${i + 1} of ${round.cards.length}`} state={reveal ? (reveal.correct ? "right" : "wrong") : "face"}>
            {chips(guess, guessed.find((g) => g.id === current.id)?.guess, reveal?.class, !!pending)}
            {reveal && revealPanel(reveal, guessed.find((g) => g.id === current.id)?.guess, false)}
            {reveal && (
              <div className="actions">
                <button type="button" className="btn primary" onClick={next} autoFocus>
                  {i + 1 >= round.cards.length ? "See your score" : "Next card"} <kbd>↵</kbd>
                </button>
              </div>
            )}
          </WalletCard>
        </section>
      )}

      {phase === "done" && round && (
        <section className="score card winner" aria-label="your score">
          <div className="score-big">
            You read wallets <b>{correct}/10</b>
          </div>
          <p className="score-sub">
            round <code>{round.seed}</code> · deck <code>{round.deckHash.slice(0, 12)}</code> · the house rule reads {round.house}/10 of these from the same
            clues
          </p>
          <ul className="score-classes">
            {DECK_CLASSES.map((k) => {
              const seen = guessed.filter((g) => g.reveal.class === k);
              const right = seen.filter((g) => g.reveal.correct).length;
              return (
                <li key={k}>
                  <span style={{ color: CLASS_INFO[k].hue }}>{CLASS_INFO[k].name}</span> {right}/{seen.length}
                </li>
              );
            })}
          </ul>
          <ul className="score-list">
            {guessed.map((g, n) => (
              <li key={g.id} className={g.reveal.correct ? "ok" : "miss"}>
                <span>{n + 1}</span> <span className="mono">{shortAddr(g.reveal.address)}</span>{" "}
                <b style={{ color: CLASS_INFO[g.reveal.class].hue }}>{CLASS_INFO[g.reveal.class].name}</b>
                {!g.reveal.correct && <span className="muted"> — you said {CLASS_INFO[g.guess].name}</span>}
              </li>
            ))}
          </ul>
          <div className="actions">
            <button type="button" className="btn primary" onClick={share}>
              Share this round
            </button>
            <button type="button" className="btn" onClick={() => start("")}>
              Play a new round
            </button>
            <button type="button" className="btn" onClick={() => draw()} disabled={drawBusy}>
              Draw a fresh card (live)
            </button>
          </div>
        </section>
      )}

      {phase === "draw" && (
        <section className="round" aria-label="a fresh card, live from Nansen">
          {drawBusy && !drawCardState && (
            <>
              <div className="draw-rows">
                <div className="draw-row pending" role="status" aria-live="polite">
                  <span className="spinner" aria-hidden /> {status || "connecting…"}
                  <span className="draw-row-hint">{rows.length ? `${rows.length} of 5 calls landed` : "calls stream into the Nansen rail as they land"}</span>
                </div>
              </div>
              {/* loading state: the shape of the card about to land, while the clue calls stream into the rail */}
              <div className="wallet-sk" aria-hidden>
                <div className="wallet-top">
                  <span className="sk sk-title" />
                  <span className="sk sk-badge" />
                </div>
                <div className="clues">
                  {["PnL", "Trades", "Balance", "Counterparties"].map((h) => (
                    <div key={h} className="clue">
                      <h3>{h}</h3>
                      <div className="sk sk-line" />
                      <div className="sk sk-line short" />
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
          {drawReplay && (
            <div className="banner warn">
              {drawReplay}
              <small>Live draws come back at the next UTC day, or run `npm run labelme -- draw` with your own key.</small>
            </div>
          )}
          {drawCardState && (
            <WalletCard
              clues={drawCardState.clues}
              title={drawReplay ? "Replayed card" : "Fresh card · live"}
              state={drawGuess ? (drawGuess === drawCardState.class ? "right" : "wrong") : "face"}
            >
              {chips((c) => setDrawGuess(c), drawGuess, drawGuess ? drawCardState.class : undefined)}
              {drawGuess && revealPanel(drawCardState, drawGuess, !drawReplay)}
              {drawGuess && drawHouse && (
                <p className="house">
                  The house rule read <b style={{ color: CLASS_INFO[drawHouse.guess].hue }}>{CLASS_INFO[drawHouse.guess].name}</b> — {drawHouse.because}.{" "}
                  {drawHouse.calls ? `${drawHouse.credits} credits · ${drawHouse.calls} calls · ${(drawHouse.ms / 1000).toFixed(1)} s.` : "0 credits (replay)."}
                </p>
              )}
              <div className="actions">
                {drawGuess && (
                  <button type="button" className="btn primary" onClick={() => draw()} disabled={drawBusy}>
                    Draw another
                  </button>
                )}
                {rows.length > 0 && (
                  <button type="button" className="btn" onClick={() => setDrawerOpen(true)}>
                    Provenance · {rows.length} calls
                  </button>
                )}
                <button type="button" className="btn" onClick={() => setPhase(returnPhase)}>
                  Back
                </button>
              </div>
            </WalletCard>
          )}
          {!drawCardState && !drawBusy && (
            <div className="actions center">
              <button type="button" className="btn primary" onClick={() => draw()}>
                Try again
              </button>
              <button type="button" className="btn" onClick={() => setPhase(returnPhase)}>
                Back
              </button>
            </div>
          )}
        </section>
      )}

      {phase === "idle" && idleChildren}

      <NansenRail
        rows={rail}
        currentRun={currentRun}
        onClear={() => setRail([])}
        onOpenReceipt={() => setDrawerOpen(true)}
        onRunLive={() => draw()}
        liveBusy={drawBusy}
      />

      <aside className={`drawer ${drawerOpen ? "open" : ""}`} aria-hidden={!drawerOpen} aria-label="provenance">
        <h3>
          Provenance — every Nansen call this {receiptReplayed ? "replay" : "draw"} made
          <button type="button" className="btn" onClick={() => setDrawerOpen(false)} tabIndex={drawerOpen ? 0 : -1}>
            Close
          </button>
        </h3>
        <table>
          <thead>
            <tr>
              <th>endpoint</th>
              <th>credits</th>
              <th>ms</th>
              <th>status</th>
              <th>fields used</th>
            </tr>
          </thead>
          <tbody>
            {receipt
              .filter((x) => x.call)
              .map((x) => {
                const r = x.call!;
                return (
                  <tr key={x.key}>
                    <td className="mono">{r.endpoint}</td>
                    <td>{r.credits}</td>
                    <td>{x.origin === "replayed" ? "replayed" : r.cached ? "cached" : r.totalMs}</td>
                    <td className={r.ok ? "" : "fail"}>{r.ok ? r.status : r.error}</td>
                    <td className="mono">{r.fieldsUsed.join(", ")}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
        <p className="sum" data-testid="drawer-sum">
          {rows.reduce((a, r) => a + r.credits, 0)} credits · {rows.length} calls
          {receiptReplayed ? ` · replayed from fixtures, recorded ${(receipt[0]?.recordedAt ?? "").slice(0, 10)}` : ""} · sha256 of every response recorded (
          <code>responseHash</code>)
        </p>
      </aside>
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
