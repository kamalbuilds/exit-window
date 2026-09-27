// The scenario builder's rule type and its plain-sentence renderer - split out of alarms.ts so a
// client component (the builder's live preview) can import it without pulling in alarms.ts's
// node:crypto/node:fs storage code, which can't bundle for the browser. alarms.ts re-exports
// everything here, so server code keeps importing from "@/lib/alarms" as before.

export type AlarmTrigger = "any" | "consensus" | "largest" | "high_risk";
export type AlarmAction = "alert" | "cut25" | "cut50" | "close";

/** The scenario builder's rule: WHEN a watched wallet reduces (trigger, gated by a minimum reduce
 * size), THEN what happens (action, plus whether to attach the "Ask Nansen Agent why" button).
 * Stored on the AlarmRecord, not per-watch - one rule governs every watch in the alarm. Alarms
 * created before this existed have no rule at all; every reader treats that as any/0/alert/true. */
export interface AlarmRule {
  trigger: AlarmTrigger;
  minReducePct: number; // 0..100
  consensusN?: number; // only meaningful for trigger "consensus"; default 2
  action: AlarmAction;
  askAgent: boolean;
}

function ruleWhenClause(rule: AlarmRule, watchedCount: number): string {
  const qualifier = rule.minReducePct > 0 ? ` by at least ${rule.minReducePct}%` : "";
  switch (rule.trigger) {
    case "any":
      return `When any of your ${watchedCount} watched Smart Money wallet${watchedCount === 1 ? "" : "s"} reduces${qualifier}`;
    case "consensus":
      return `When ${rule.consensusN ?? 2} or more of your ${watchedCount} watched Smart Money wallets reduce within an hour${qualifier}`;
    case "largest":
      return `When the largest holder you watch reduces${qualifier}`;
    case "high_risk":
      return `When a High exit-risk wallet you watch reduces${qualifier}`;
  }
}

function ruleThenClause(rule: AlarmRule, coin: string | null): string {
  const position = coin ? `my ${coin} position` : "my position";
  switch (rule.action) {
    case "alert":
      return "message me on Telegram";
    case "cut25":
      return `message me on Telegram and cut ${position} 25%`;
    case "cut50":
      return `message me on Telegram and cut ${position} 50%`;
    case "close":
      return `message me on Telegram and close ${position}`;
  }
}

/** The plain sentence: "When 2 or more of your 8 watched Smart Money wallets reduce within an
 * hour by at least 25%, message me on Telegram and cut my PURR position 25%." Shared by the
 * scenario builder's live preview and the onboarding message, so the two never drift apart. */
export function buildRulePreviewSentence(rule: AlarmRule, watchedCount: number, coin: string | null): string {
  return `${ruleWhenClause(rule, watchedCount)}, ${ruleThenClause(rule, coin)}.`;
}
