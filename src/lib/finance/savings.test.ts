import { describe, expect, it } from 'vitest';
import { allocateSaving, goalProgress, nextGoalToFund } from './savings';

const colchon = { id: 'c', name: 'Colchón de imprevistos', target: 300, balance: 0, priority: 10 };
const mudanza = { id: 'm', name: 'Fondo de mudanza', target: 500, balance: 0, priority: 20 };

describe('ahorros', () => {
  it('avance y faltante', () => {
    const p = goalProgress({ ...colchon, balance: 120 });
    expect(p.pct).toBeCloseTo(0.4);
    expect(p.remaining).toBe(180);
    expect(p.done).toBe(false);
    expect(goalProgress({ ...colchon, balance: 350 })).toMatchObject({ pct: 1, remaining: 0, done: true });
  });

  it('un retiro que deja saldo negativo no rompe la barra', () => {
    expect(goalProgress({ ...colchon, balance: -20 }).pct).toBe(0);
  });

  it('primero el colchón, luego la mudanza', () => {
    expect(nextGoalToFund([mudanza, colchon])?.id).toBe('c');
    expect(nextGoalToFund([mudanza, { ...colchon, balance: 300 }])?.id).toBe('m');
    expect(nextGoalToFund([{ ...mudanza, balance: 500 }, { ...colchon, balance: 300 }])).toBeNull();
  });

  it('reparte: completa el colchón y el resto a la mudanza', () => {
    expect(allocateSaving(400, [mudanza, { ...colchon, balance: 250 }])).toEqual([
      { goalId: 'c', name: 'Colchón de imprevistos', amount: 50 },
      { goalId: 'm', name: 'Fondo de mudanza', amount: 350 },
    ]);
  });

  it('si todas las metas están llenas, el sobrante va a la última', () => {
    expect(allocateSaving(100, [{ ...colchon, balance: 300 }, { ...mudanza, balance: 500 }])).toEqual([
      { goalId: 'm', name: 'Fondo de mudanza', amount: 100 },
    ]);
  });
});
