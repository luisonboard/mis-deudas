import { useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatMoney, formatMonth } from '../lib/format';
import type { PlanResult } from '../lib/finance/simulate';

// Paleta validada (scripts/validate_palette.js, modo oscuro, superficie #0b1222):
// slot 1 azul para el plan, slot 2 naranja para la base. La base además va punteada.
const PLAN = '#3987e5';
const BASE = '#d95926';
const SURFACE = '#0b1222';

interface Point {
  month: string;
  plan: number | null;
  base: number | null;
}

function toPoints(startMonth: string, startDebt: number, plan: PlanResult, base: PlanResult): Point[] {
  const months = Math.max(plan.months.length, base.months.length);
  const pts: Point[] = [{ month: startMonth, plan: startDebt, base: startDebt }];
  for (let i = 0; i < months; i++) {
    const p = plan.months[i];
    const b = base.months[i];
    pts.push({ month: (p ?? b).month, plan: p ? p.totalDebtEnd : null, base: b ? b.totalDebtEnd : null });
  }
  return pts;
}

const shortMoney = (n: number) => (n >= 1000 ? `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace('.', ',')}k` : `$${Math.round(n)}`);

function Key({ color, dashed }: { color: string; dashed?: boolean }) {
  return (
    <svg width="18" height="8" aria-hidden className="shrink-0">
      <line x1="1" y1="4" x2="17" y2="4" stroke={color} strokeWidth="2" strokeLinecap="round" strokeDasharray={dashed ? '4 3' : undefined} />
    </svg>
  );
}

interface TipProps {
  active?: boolean;
  label?: string;
  payload?: { dataKey?: string | number; value?: number | null }[];
}

function Tip({ active, label, payload }: TipProps) {
  if (!active || !payload?.length || !label) return null;
  const v = (k: string) => payload.find((p) => p.dataKey === k)?.value;
  const plan = v('plan');
  const base = v('base');
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-950/95 px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 text-slate-400">{formatMonth(label)}</p>
      {plan !== undefined && plan !== null && (
        <p className="flex items-center gap-2">
          <Key color={PLAN} />
          <strong className="tabular-nums text-slate-100">{formatMoney(plan)}</strong>
          <span className="text-slate-400">tu plan</span>
        </p>
      )}
      {base !== undefined && base !== null && (
        <p className="flex items-center gap-2">
          <Key color={BASE} dashed />
          <strong className="tabular-nums text-slate-100">{formatMoney(base)}</strong>
          <span className="text-slate-400">sin abonos</span>
        </p>
      )}
    </div>
  );
}

/** Deuda total proyectada: tu plan frente al plan base (sin abonos extra ni décimos). */
export function DebtChart({ startMonth, startDebt, plan, base }: { startMonth: string; startDebt: number; plan: PlanResult; base: PlanResult }) {
  const data = useMemo(() => toPoints(startMonth, startDebt, plan, base), [startMonth, startDebt, plan, base]);
  const [showTable, setShowTable] = useState(false);

  return (
    <figure>
      <figcaption className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-300">
        <span className="flex items-center gap-1.5">
          <Key color={PLAN} /> Tu plan{plan.debtFreeMonth ? ` · ${formatMonth(plan.debtFreeMonth, true)}` : ''}
        </span>
        <span className="flex items-center gap-1.5">
          <Key color={BASE} dashed /> Sin abonos extra{base.debtFreeMonth ? ` · ${formatMonth(base.debtFreeMonth, true)}` : ''}
        </span>
      </figcaption>
      <div className="h-56 w-full" role="img" aria-label="Gráfico de la deuda total proyectada: tu plan frente al plan sin abonos extra">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="#1e293b" strokeWidth={1} vertical={false} />
            <XAxis
              dataKey="month"
              tickFormatter={(m: string) => formatMonth(m, true)}
              tick={{ fill: '#94a3b8', fontSize: 11 }}
              axisLine={{ stroke: '#334155' }}
              tickLine={false}
              minTickGap={24}
            />
            <YAxis tickFormatter={shortMoney} tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} width={44} />
            <Tooltip content={<Tip />} cursor={{ stroke: '#64748b', strokeWidth: 1 }} isAnimationActive={false} />
            <Line
              type="monotone"
              dataKey="base"
              stroke={BASE}
              strokeWidth={2}
              strokeDasharray="6 4"
              dot={false}
              activeDot={{ r: 4, fill: BASE, stroke: SURFACE, strokeWidth: 2 }}
              connectNulls={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="plan"
              stroke={PLAN}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: PLAN, stroke: SURFACE, strokeWidth: 2 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <button type="button" className="mt-1 min-h-[44px] text-xs text-slate-400 underline" onClick={() => setShowTable((v) => !v)}>
        {showTable ? 'Ocultar tabla' : 'Ver como tabla'}
      </button>
      {showTable && (
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-right text-xs tabular-nums">
            <thead className="sticky top-0 bg-slate-900 text-slate-400">
              <tr>
                <th className="py-1 text-left">Mes</th>
                <th>Tu plan</th>
                <th>Sin abonos</th>
              </tr>
            </thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.month} className="border-t border-slate-800">
                  <td className="py-1 text-left">{formatMonth(p.month, true)}</td>
                  <td>{p.plan === null ? '—' : formatMoney(p.plan)}</td>
                  <td>{p.base === null ? '—' : formatMoney(p.base)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </figure>
  );
}
