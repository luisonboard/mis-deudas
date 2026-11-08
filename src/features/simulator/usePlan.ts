import { useMemo } from 'react';
import { useDebts, usePayments, useSettings } from '../../lib/api';
import { todayIn } from '../../lib/dates';
import { buildPlanInput, type PlanOverrides } from '../../lib/finance/fromData';
import { basePlanInput, simulatePlan } from '../../lib/finance/simulate';

/** Corre simulatePlan dos veces: con el plan (y los cambios del simulador) y en "base". */
export function usePlan(overrides: PlanOverrides = {}) {
  const settings = useSettings();
  const debts = useDebts();
  const payments = usePayments();
  const today = todayIn(settings.data?.timezone);

  const key = JSON.stringify(overrides);
  const result = useMemo(() => {
    if (!debts.data || !payments.data) return null;
    const input = buildPlanInput(debts.data, payments.data, settings.data ?? null, today, JSON.parse(key) as PlanOverrides);
    const plan = simulatePlan(input);
    const base = simulatePlan(basePlanInput(input));
    const startDebt = input.debts.reduce((s, d) => s + d.balance, 0);
    return { input, plan, base, startDebt };
  }, [debts.data, payments.data, settings.data, today, key]);

  return {
    ...result,
    isLoading: settings.isLoading || debts.isLoading || payments.isLoading,
    error: settings.error || debts.error || payments.error,
    refetch: () => {
      settings.refetch();
      debts.refetch();
      payments.refetch();
    },
  };
}
