import { useMemo, useState } from 'react';
import {
  useCheckins,
  useDebts,
  useFixedExpenses,
  useFixedPayments,
  useIncomes,
  usePayments,
  useSavingsGoals,
  useSavingsMovements,
  useSettings,
} from '../../lib/api';
import { formatDate, formatMoney, formatPct } from '../../lib/format';
import { buildDailyReco } from '../../lib/finance/fromData';
import type { RecoTarget } from '../../lib/finance/recommend';
import { INCOME_KIND_LABEL } from '../../lib/types';
import { Button, Card, Empty, Sheet, useOnline } from '../../components/ui';
import { PaymentForm } from '../daily/forms';

function Targets({ targets, loanIds }: { targets: RecoTarget[]; loanIds: Set<string> }) {
  return (
    <ul className="mt-1 text-sm text-slate-300">
      {targets.map((t) => (
        <li key={t.debtId}>
          → <strong>{formatMoney(t.amount)}</strong> a {t.name}
          {loanIds.has(t.debtId) && <span className="block text-xs text-slate-400">Pide al banco que reduzca el plazo, no la cuota.</span>}
        </li>
      ))}
    </ul>
  );
}

/** Recomendación del día (sección 5.5): cuánto abonar, a qué deuda, tope diario y el porqué. */
export function RecoCard({ today }: { today: string }) {
  const settings = useSettings();
  const checkins = useCheckins();
  const debts = useDebts();
  const payments = usePayments();
  const incomes = useIncomes();
  const fixed = useFixedExpenses();
  const fixedPayments = useFixedPayments();
  const movements = useSavingsMovements();
  const goals = useSavingsGoals();
  const online = useOnline();
  const [paying, setPaying] = useState<{ debtId: string; amount: number } | null>(null);

  const latest = checkins.data?.[0];
  const ready =
    settings.data && latest && debts.data && payments.data && incomes.data && fixed.data && fixedPayments.data && movements.data;

  const result = useMemo(() => {
    if (!ready) return null;
    // El colchón es la meta de ahorro con mayor prioridad (número menor).
    const colchon = goals.data?.[0];
    return buildDailyReco({
      today,
      balance: latest!.balance,
      settings: settings.data!,
      debts: debts.data!,
      payments: payments.data!,
      incomes: incomes.data!,
      fixed: fixed.data!,
      fixedPayments: fixedPayments.data!,
      movements: movements.data!,
      colchonBalance: colchon?.balance ?? 0,
    });
  }, [ready, today, latest, settings.data, debts.data, payments.data, incomes.data, fixed.data, fixedPayments.data, movements.data, goals.data]);

  if (!settings.data) return null;
  if (!latest) {
    return (
      <Card title="Recomendación del día">
        <Empty>Guarda el saldo de hoy para ver cuánto conviene abonar.</Empty>
      </Card>
    );
  }
  if (!result) return null;

  const s = settings.data;
  const { reco, cycle, savingPending, targets, decimo } = result;
  const loanIds = new Set((debts.data ?? []).filter((d) => d.kind === 'loan').map((d) => d.id));
  const stale = latest.checked_on !== today;

  return (
    <>
      {decimo && (
        <Card title={`Tu ${INCOME_KIND_LABEL[decimo.kind].toLowerCase()}`} className="border-sky-500/40">
          <p className="text-sm text-slate-300">
            Recibiste {formatMoney(decimo.amount)} el {formatDate(decimo.receivedOn)}. Abona el {formatPct(s.decimos_pct_to_debt, 0)} sin margen de seguridad:
          </p>
          <p className="mt-2 text-2xl font-bold tabular-nums">Abona {formatMoney(decimo.abono)}</p>
          <Targets targets={decimo.targets} loanIds={loanIds} />
          <p className="mt-2 text-sm text-slate-400">
            El resto: {formatMoney(decimo.toColchon)} al colchón y {formatMoney(decimo.toSaving)} al ahorro.
          </p>
          {decimo.targets[0] && (
            <Button className="mt-3 w-full" disabled={!online} onClick={() => setPaying({ debtId: decimo.targets[0].debtId, amount: decimo.targets[0].amount })}>
              Registrar abono
            </Button>
          )}
        </Card>
      )}

      <Card title="Recomendación del día">
        {stale && (
          <p role="alert" className="mb-2 text-xs text-amber-300">
            Calculado con el saldo del {formatDate(latest.checked_on)}. Guarda el de hoy para afinarlo.
          </p>
        )}

        {reco.abono > 0 ? (
          <>
            <p className="text-3xl font-bold tabular-nums">Abona {formatMoney(reco.abono)}</p>
            <Targets targets={targets} loanIds={loanIds} />
          </>
        ) : reco.deficit > 0 ? (
          <p className="text-xl font-bold">Hoy no abones</p>
        ) : (
          <>
            <p className="text-xl font-bold">Hoy no conviene abonar</p>
            <p className="text-sm text-slate-400">
              Lo que sobra con margen ({formatMoney(reco.gross)}) no llega al mínimo de {formatMoney(s.abono_min)}.
            </p>
          </>
        )}

        <div className={`mt-3 rounded-xl p-3 ${reco.capBelowPlan ? 'bg-red-500/15' : 'bg-slate-800/60'}`}>
          <p className={`text-sm ${reco.capBelowPlan ? 'text-red-300' : 'text-slate-300'}`}>
            Gasta como máximo <strong className="text-lg tabular-nums">{formatMoney(Math.max(reco.dailyCap, 0))}</strong> / día
          </p>
          {reco.capBelowPlan && (
            <p role="alert" className="mt-1 text-xs text-red-300">
              Está por debajo de tu tope planificado de {formatMoney(s.daily_living_budget)}. Te faltan {formatMoney(reco.deficit)} para cubrir todo hasta el sueldo.
            </p>
          )}
          <p className="mt-1 text-xs text-slate-400">
            Próximo sueldo: {formatDate(cycle.nextPayday)} · {reco.days} día{reco.days === 1 ? '' : 's'}
          </p>
        </div>

        <ul className="mt-3 space-y-0.5 text-xs text-slate-400 tabular-nums">
          <li>Saldo {formatMoney(latest.balance)} − obligaciones {formatMoney(reco.obligations)}</li>
          <li>
            − gasto de vida {formatMoney(reco.livingCost)} ({reco.days} × {formatMoney(s.daily_living_budget)}) − colchón {formatMoney(s.colchon_target)}
            {savingPending > 0 && ` − ahorro ${formatMoney(savingPending)}`}
          </li>
          <li>
            = sobrante seguro <strong className={reco.safeSurplus < 0 ? 'text-red-300' : 'text-slate-200'}>{formatMoney(reco.safeSurplus)}</strong>
          </li>
          {reco.safeSurplus > 0 && (
            <li>
              Margen de seguridad {formatPct(s.abono_safety_pct, 0)} → {formatMoney(reco.gross)}, redondeado a múltiplos de {formatMoney(s.abono_round)}
            </li>
          )}
        </ul>

        {reco.obligationsList.length > 0 && (
          <details className="mt-2 text-sm">
            <summary className="min-h-[44px] cursor-pointer py-2 text-slate-300">
              Obligaciones hasta el sueldo ({reco.obligationsList.length})
            </summary>
            <ul className="divide-y divide-slate-800">
              {reco.obligationsList.map((o, i) => (
                <li key={`${o.name}-${o.due}-${i}`} className="flex justify-between py-1.5 text-slate-300">
                  <span>
                    {o.name}
                    <span className="text-xs text-slate-500"> · {o.due ? formatDate(o.due) : 'sin fecha'}</span>
                  </span>
                  <span className="tabular-nums">{formatMoney(o.amount)}</span>
                </li>
              ))}
            </ul>
          </details>
        )}

        {reco.abono > 0 && targets[0] && (
          <Button className="mt-3 w-full" disabled={!online} onClick={() => setPaying({ debtId: targets[0].debtId, amount: targets[0].amount })}>
            Registrar abono a {targets[0].name}
          </Button>
        )}
      </Card>

      <Sheet title="Registrar abono" open={paying !== null} onClose={() => setPaying(null)}>
        {paying && (
          <PaymentForm
            key={`${paying.debtId}-${paying.amount}`}
            debtId={paying.debtId}
            initialKind="extra"
            initialAmount={paying.amount}
            onDone={() => setPaying(null)}
          />
        )}
      </Sheet>
    </>
  );
}
