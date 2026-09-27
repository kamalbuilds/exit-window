"use client";

import {
  DEFAULT_FILTERS,
  LABEL_TYPE_OPTIONS,
  MIN_POSITION_OPTIONS,
  isDefaultFilters,
  type ExitRiskFilter,
  type FilterCohort,
  type LabelType,
  type SmartMoneyFilters,
} from "./smartMoneyFilters";

const COHORT_OPTIONS: { id: FilterCohort; text: string }[] = [
  { id: "smart_money", text: "Smart Money" },
  { id: "whale", text: "Whale" },
];

const EXIT_RISK_OPTIONS: { id: ExitRiskFilter; text: string }[] = [
  { id: "any", text: "Any" },
  { id: "high", text: "High only" },
  { id: "medium_plus", text: "Medium+" },
];

function toggleChip<T>(list: T[], id: T): T[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`chip transition-[background-color,color] duration-150 ${active ? "chip-lume" : "chip-mute"}`}
    >
      {children}
    </button>
  );
}

export function SmartMoneyFilterBar({
  filters,
  onChange,
  shownCount,
  totalCount,
}: {
  filters: SmartMoneyFilters;
  onChange: (next: SmartMoneyFilters) => void;
  shownCount: number;
  totalCount: number;
}) {
  const isDefault = isDefaultFilters(filters);

  return (
    <section aria-label="Smart Money filters" className="panel mt-4 px-4 py-3 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="label mr-1">Cohort</span>
          {COHORT_OPTIONS.map((o) => (
            <Chip key={o.id} active={filters.cohorts.includes(o.id)} onClick={() => onChange({ ...filters, cohorts: toggleChip(filters.cohorts, o.id) })}>
              {o.text}
            </Chip>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="label mr-1">Label</span>
          {LABEL_TYPE_OPTIONS.map((o) => (
            <Chip
              key={o.id}
              active={filters.labelTypes.includes(o.id)}
              onClick={() => onChange({ ...filters, labelTypes: toggleChip(filters.labelTypes, o.id) })}
            >
              {o.text}
            </Chip>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <label className="flex items-center gap-2 text-[13px] text-ink-2">
          <input
            type="checkbox"
            checked={filters.hideReferralOnly}
            onChange={(e) => onChange({ ...filters, hideReferralOnly: e.target.checked })}
            className="w-4 h-4 accent-[var(--color-ink)]"
          />
          Hide referral-only wallets
        </label>

        <label className="flex items-center gap-2 text-[13px] text-ink-2">
          Min position
          <select
            value={filters.minPositionUsd}
            onChange={(e) => onChange({ ...filters, minPositionUsd: Number(e.target.value) })}
            className="h-8 px-2 bg-paper border border-rule rounded-lg text-ink text-[13px]"
          >
            {MIN_POSITION_OPTIONS.map((o) => (
              <option key={o.usd} value={o.usd}>
                {o.text}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-1.5">
          <span className="label mr-1">Exit risk</span>
          <div className="flex items-center gap-1 bg-bezel rounded-lg p-1">
            {EXIT_RISK_OPTIONS.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => onChange({ ...filters, exitRisk: o.id })}
                aria-pressed={filters.exitRisk === o.id}
                className={`h-7 px-2.5 rounded-md text-[12px] transition-colors duration-150 ${
                  filters.exitRisk === o.id ? "border border-rule text-accent" : "text-ink-3 hover:text-ink"
                }`}
              >
                {o.text}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1" />

        <p className="fig text-[12px] text-ink-3">
          Showing {shownCount} of {totalCount} Smart Money wallets
        </p>

        {!isDefault && (
          <button type="button" onClick={() => onChange(DEFAULT_FILTERS)} className="text-[12px] text-ink-2 underline decoration-rule hover:decoration-ink">
            Reset
          </button>
        )}
      </div>
    </section>
  );
}

export const STORAGE_KEY = "exitwindow.smFilters";

export function loadFiltersFromStorage(): SmartMoneyFilters {
  if (typeof window === "undefined") return DEFAULT_FILTERS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_FILTERS;
    const parsed = JSON.parse(raw) as Partial<SmartMoneyFilters>;
    return {
      cohorts: Array.isArray(parsed.cohorts) ? (parsed.cohorts as FilterCohort[]) : DEFAULT_FILTERS.cohorts,
      labelTypes: Array.isArray(parsed.labelTypes) ? (parsed.labelTypes as LabelType[]) : DEFAULT_FILTERS.labelTypes,
      hideReferralOnly: typeof parsed.hideReferralOnly === "boolean" ? parsed.hideReferralOnly : DEFAULT_FILTERS.hideReferralOnly,
      minPositionUsd: typeof parsed.minPositionUsd === "number" ? parsed.minPositionUsd : DEFAULT_FILTERS.minPositionUsd,
      exitRisk: parsed.exitRisk === "high" || parsed.exitRisk === "medium_plus" || parsed.exitRisk === "any" ? parsed.exitRisk : DEFAULT_FILTERS.exitRisk,
    };
  } catch {
    return DEFAULT_FILTERS;
  }
}

export function saveFiltersToStorage(filters: SmartMoneyFilters): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
  } catch {
    // localStorage can throw (private mode, quota) - filters just don't persist this session.
  }
}
