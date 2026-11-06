import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useDebts } from '../../lib/api';
import { addMonths, todayIn } from '../../lib/dates';
import { formatMoney, formatMonth, formatPct } from '../../lib/format';
import { amortizationSchedule } from '../../lib/finance/schedule';
import { DEBT_KIND_LABEL, type Debt } from '../../lib/types';
import { Button, Card, Empty, ErrorBox, Loading, ProgressBar, Sheet } from '../../components/ui';
import { DebtForm } from './DebtForm';

/** Fecha estimada de fin pagando solo la cuota (o el mínimo) desde el mes actual. */
export function estimatedEnd(d: Debt, today = todayIn()): string | null {
  if (d.current_balance <= 0.005) return null;
  const payment = d.kind === 'revolving' ? d.min_payment ?? 0 : d.monthly_payment;
  const rate = d.kind === 'fixed_installments' ? 0 : d.annual_rate;
  const rows = amortizationSchedule(d.current_balance, rate, payment, 600);
  if (rows.length === 0 || rows[rows.length - 1].balanceEnd > 0.005) return null;
  const start = d.first_payment_date && d.first_payment_date > today ? d.first_payment_date.slice(0, 7) : today.slice(0, 7);
  return addMonths(start, rows.length - 1);
}

export function DebtsPage() {
  const debts = useDebts();
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Deudas</h1>
        <Button onClick={() => setCreating(true)}>+ Nueva</Button>
      </header>
      {debts.isLoading && <Loading />}
      {debts.error && <ErrorBox error={debts.error} onRetry={() => debts.refetch()} />}
      {debts.data && debts.data.length === 0 && <Empty>Aún no registras deudas. Toca “+ Nueva”.</Empty>}
      <ul className="flex flex-col gap-3">
        {debts.data?.map((d) => {
          const paidPct = d.initial_balance > 0 ? 1 - d.current_balance / d.initial_balance : 1;
          const end = estimatedEnd(d);
          return (
            <li key={d.id}>
              <Link to={`/deudas/${d.id}`} className="block rounded-2xl focus:outline-none focus:ring-2 focus:ring-emerald-400">
                <Card>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h2 className="font-semibold">{d.name}</h2>
                      <p className="text-xs text-slate-400">
                        {DEBT_KIND_LABEL[d.kind]} · {formatPct(d.annual_rate)}
                        {d.status !== 'active' && <span className="ml-2 rounded bg-emerald-500/20 px-1.5 text-emerald-300">{d.status === 'paid' ? 'Pagada' : 'Archivada'}</span>}
                      </p>
                    </div>
                    <p className="text-right text-lg font-bold tabular-nums">{formatMoney(d.current_balance)}</p>
                  </div>
                  <div className="mt-3">
                    <ProgressBar value={paidPct} label={`${d.name}: pagado`} />
                  </div>
                  <div className="mt-2 flex justify-between text-xs text-slate-400">
                    <span>
                      {d.kind === 'revolving' ? 'Mínimo' : 'Cuota'} {formatMoney((d.kind === 'revolving' ? d.min_payment : d.monthly_payment) ?? 0)}
                    </span>
                    <span>{formatPct(paidPct, 0)} pagado</span>
                    <span>{end ? `Fin ${formatMonth(end, true)}` : d.status === 'paid' ? 'Terminada' : 'Sin fecha'}</span>
                  </div>
                </Card>
              </Link>
            </li>
          );
        })}
      </ul>
      <Sheet title="Nueva deuda" open={creating} onClose={() => setCreating(false)}>
        <DebtForm onDone={() => setCreating(false)} />
      </Sheet>
    </div>
  );
}
