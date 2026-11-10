import { describe, expect, it } from 'vitest';
import { buildHistory, dailyPoints, summarizeMonth, type HistoryMovement } from './history';

const close = (a: number | null, b: number, tol = 0.01) => expect(Math.abs((a ?? NaN) - b)).toBeLessThanOrEqual(tol);

const checkins = [
  { date: '2026-11-06', balance: 963.66 },
  { date: '2026-11-07', balance: 951.16 },
  { date: '2026-11-08', balance: 880 },
  { date: '2026-11-11', balance: 790 },
];
const movs: (HistoryMovement & { affectsBalance?: boolean })[] = [
  { date: '2026-11-08', type: 'fixed', name: 'Internet', amount: 25 },
  { date: '2026-11-10', type: 'income', name: 'Otro', amount: 40 },
  { date: '2026-11-10', type: 'saving', name: 'Colchón', amount: 50, affectsBalance: false },
  { date: '2026-11-11', type: 'saving', name: 'Mudanza', amount: 30 },
];

describe('historial', () => {
  const rows = buildHistory(checkins, movs, 12.5);

  it('una fila por check-in, la más reciente primero', () => {
    expect(rows.map((r) => r.date)).toEqual(['2026-11-11', '2026-11-08', '2026-11-07', '2026-11-06']);
    expect(rows[3].estimated).toBeNull();
  });

  it('gasto estimado por intervalo, descontando movimientos (5.5)', () => {
    close(rows[2].estimated, 12.5); // 6→7 nov
    close(rows[1].estimated, 951.16 - 25 - 880); // 46,16 con el Internet
    // 8→11 nov: +40 ingreso − 30 mudanza; el colchón no pasa por la cuenta
    close(rows[0].estimated, 880 + 40 - 30 - 790);
    expect(rows[0].days).toBe(3);
    close(rows[0].perDay, 100 / 3);
    expect(rows[0].overBudget).toBe(true);
    expect(rows[0].movements.map((m) => m.name)).toEqual(['Otro', 'Colchón', 'Mudanza']);
  });

  it('marca los intervalos con gasto negativo', () => {
    const r = buildHistory([{ date: '2026-11-01', balance: 100 }, { date: '2026-11-02', balance: 300 }], [], 12.5);
    expect(r[0].suspicious).toBe(true);
    expect(r[0].overBudget).toBe(false);
  });

  it('resumen del mes', () => {
    const s = summarizeMonth(rows, '2026-11', 12.5, movs);
    close(s.spent, 12.5 + 46.16 + 100);
    expect(s.days).toBe(5);
    expect(s.daysUnder).toBe(1);
    close(s.budget, 62.5);
    expect([s.incomes, s.fixedPaid, s.saved]).toEqual([40, 25, 80]);
    expect([s.firstBalance, s.lastBalance]).toEqual([963.66, 790]);
  });

  it('puntos por día: reparte los intervalos de varios días', () => {
    const pts = dailyPoints(rows, '2026-11', 12.5);
    expect(pts.map((p) => p.date)).toEqual(['2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11']);
    expect(pts[2]).toMatchObject({ averaged: true, over: true });
    close(pts[2].spent, 100 / 3);
  });
});
