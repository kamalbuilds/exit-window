"use client";

import { useEffect, useId, useRef } from "react";
import { buildRulePreviewSentence, type AlarmAction, type AlarmRule, type AlarmTrigger } from "@/lib/alarmRule";

const TRIGGER_OPTIONS: { id: AlarmTrigger; title: string; hint: string }[] = [
  { id: "any", title: "Any wallet I watch reduces", hint: "Fires the moment any one of them cuts." },
  { id: "consensus", title: "2 or more reduce within 1 hour", hint: "Consensus: waits for agreement before it fires." },
  { id: "largest", title: "The largest holder reduces", hint: "Only your biggest watched position matters." },
  { id: "high_risk", title: "A High exit-risk wallet reduces", hint: "Only wallets rated High exit risk." },
  {
    id: "near_liquidation",
    title: "Price nears the largest holder's liquidation",
    hint: "A forced exit sells into yours. This times that, not a reduce.",
  },
];

const MIN_REDUCE_OPTIONS: { pct: number; text: string }[] = [
  { pct: 0, text: "any" },
  { pct: 10, text: "10%" },
  { pct: 25, text: "25%" },
  { pct: 50, text: "50%" },
];

const ACTION_OPTIONS: { id: AlarmAction; title: string; hint: string }[] = [
  { id: "alert", title: "Alert me", hint: "Message on Telegram, no position change." },
  { id: "cut25", title: "Alert and cut my position 25%", hint: "" },
  { id: "cut50", title: "Alert and cut my position 50%", hint: "" },
  { id: "close", title: "Alert and close", hint: "Fully exits the position." },
];

export interface Preset {
  name: string;
  rule: AlarmRule;
}

export const PRESETS: Preset[] = [
  { name: "Conservative", rule: { trigger: "consensus", minReducePct: 25, consensusN: 2, action: "alert", askAgent: true } },
  { name: "Protect profits", rule: { trigger: "largest", minReducePct: 10, action: "cut50", askAgent: true } },
  { name: "Paranoid", rule: { trigger: "any", minReducePct: 0, action: "close", askAgent: true } },
];

function Card({ active, onClick, title, hint }: { active: boolean; onClick: () => void; title: string; hint?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`text-left rounded-lg border px-3.5 py-3 transition-[background-color,border-color] duration-150 ${
        active ? "border-accent bg-lume-wash" : "border-rule bg-paper hover:bg-bezel"
      }`}
    >
      <p className={`text-[13px] font-medium ${active ? "text-accent" : "text-ink"}`}>{title}</p>
      {hint && <p className="mt-0.5 text-[12px] text-ink-3">{hint}</p>}
    </button>
  );
}

export function ScenarioPanel({
  open,
  onClose,
  rule,
  onChange,
  watchedCount,
  coin,
  onArm,
  arming,
}: {
  open: boolean;
  onClose: () => void;
  rule: AlarmRule;
  onChange: (next: AlarmRule) => void;
  watchedCount: number;
  coin: string | null;
  onArm: () => void;
  arming: boolean;
}) {
  const titleId = useId();
  const liqPctId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    dialogRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const preview = buildRulePreviewSentence(rule, watchedCount, coin);

  return (
    <div className="fixed inset-0 z-30 flex items-end sm:items-center justify-center bg-black/60 px-0 sm:px-4">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 cursor-default" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="panel relative z-10 w-full sm:max-w-xl max-h-[90vh] overflow-y-auto p-5 sm:rounded-2xl rounded-t-2xl outline-none"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id={titleId} className="text-[17px] font-semibold text-ink">
            Arm exit alarm
          </h2>
          <button type="button" onClick={onClose} aria-label="Close scenario builder" className="text-[13px] text-ink-3 hover:text-ink">
            Esc
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.name}
              type="button"
              onClick={() => onChange(p.rule)}
              className="chip chip-mute hover:bg-rule transition-colors duration-150"
            >
              {p.name}
            </button>
          ))}
        </div>

        <p className="label mt-5">When</p>
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
          {TRIGGER_OPTIONS.map((o) => (
            <Card key={o.id} active={rule.trigger === o.id} onClick={() => onChange({ ...rule, trigger: o.id })} title={o.title} hint={o.hint} />
          ))}
        </div>

        {rule.trigger === "near_liquidation" && (
          <div className="mt-4">
            <label htmlFor={liqPctId} className="label">
              Within
            </label>
            <div className="mt-2 flex items-center gap-2">
              <input
                id={liqPctId}
                type="number"
                min={1}
                max={100}
                step={1}
                inputMode="decimal"
                value={rule.liqWithinPct ?? 5}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  onChange({ ...rule, liqWithinPct: Number.isFinite(n) && n > 0 ? n : 5 });
                }}
                className="fig h-8 w-20 rounded-md border border-rule bg-bezel px-2 text-[13px] text-ink"
              />
              <span className="text-[13px] text-ink-2">% of the liquidation price</span>
            </div>
          </div>
        )}

        <p className="label mt-4">Minimum reduce</p>
        <div className="mt-2 flex items-center gap-1 bg-bezel rounded-lg p-1 w-fit">
          {MIN_REDUCE_OPTIONS.map((o) => (
            <button
              key={o.pct}
              type="button"
              onClick={() => onChange({ ...rule, minReducePct: o.pct })}
              aria-pressed={rule.minReducePct === o.pct}
              className={`h-8 px-3 rounded-md text-[13px] transition-colors duration-150 ${
                rule.minReducePct === o.pct ? "border border-rule text-accent" : "text-ink-3 hover:text-ink"
              }`}
            >
              {o.text}
            </button>
          ))}
        </div>

        <p className="label mt-5">Then</p>
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
          {ACTION_OPTIONS.map((o) => (
            <Card key={o.id} active={rule.action === o.id} onClick={() => onChange({ ...rule, action: o.id })} title={o.title} hint={o.hint} />
          ))}
        </div>

        <label className="mt-4 flex items-center gap-2 text-[13px] text-ink-2">
          <input
            type="checkbox"
            checked={rule.askAgent}
            onChange={(e) => onChange({ ...rule, askAgent: e.target.checked })}
            className="w-4 h-4 accent-[var(--color-ink)]"
          />
          Ask Nansen Agent why
        </label>

        <div className="mt-5 rounded-lg border border-rule bg-bezel px-3.5 py-3">
          <p className="text-[13px] text-ink text-balance">{preview}</p>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary h-10 px-4 text-[14px]">
            Cancel
          </button>
          <button
            type="button"
            onClick={onArm}
            disabled={watchedCount === 0 || arming}
            className="btn-primary h-10 px-5 text-[14px] disabled:cursor-not-allowed"
          >
            {arming ? "Arming" : "Arm alarm"}
          </button>
        </div>
      </div>
    </div>
  );
}
