export interface GoalInput {
  id: string;
  name: string;
  target: number;
  balance: number;
  priority: number;
}

export interface GoalProgress extends GoalInput {
  /** 0–1 (recortado). Una meta sin objetivo cuenta como completa si tiene saldo. */
  pct: number;
  remaining: number;
  done: boolean;
}

export function goalProgress(g: GoalInput): GoalProgress {
  const remaining = Math.max(g.target - g.balance, 0);
  const pct = g.target > 0 ? Math.min(Math.max(g.balance / g.target, 0), 1) : g.balance > 0 ? 1 : 0;
  return { ...g, pct, remaining, done: g.target > 0 ? remaining <= 0.005 : false };
}

/**
 * Regla "primero el colchón": las metas se llenan por prioridad ascendente.
 * Devuelve la meta que debe recibir el próximo ahorro (la primera incompleta) o null.
 */
export function nextGoalToFund(goals: GoalInput[]): GoalProgress | null {
  const sorted = [...goals].sort((a, b) => a.priority - b.priority).map(goalProgress);
  return sorted.find((g) => g.target > 0 && !g.done) ?? null;
}

/**
 * Reparte un monto entre las metas por prioridad: cada una hasta su objetivo y
 * el sobrante a la última meta (o sin asignar si no hay metas).
 */
export function allocateSaving(amount: number, goals: GoalInput[]): { goalId: string; name: string; amount: number }[] {
  const sorted = [...goals].sort((a, b) => a.priority - b.priority).map(goalProgress);
  const out: { goalId: string; name: string; amount: number }[] = [];
  let left = amount;
  for (const g of sorted) {
    if (left <= 0.005) break;
    if (g.done || g.target <= 0) continue;
    const a = Math.min(left, g.remaining);
    out.push({ goalId: g.id, name: g.name, amount: Math.round(a * 100) / 100 });
    left -= a;
  }
  if (left > 0.005 && sorted.length > 0) {
    const last = sorted[sorted.length - 1];
    const existing = out.find((o) => o.goalId === last.id);
    if (existing) existing.amount = Math.round((existing.amount + left) * 100) / 100;
    else out.push({ goalId: last.id, name: last.name, amount: Math.round(left * 100) / 100 });
  }
  return out;
}
