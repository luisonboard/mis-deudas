import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import type {
  BalanceCheckin,
  Debt,
  FixedExpense,
  FixedExpensePayment,
  Income,
  Payment,
  SavingsMovement,
  Settings,
} from './types';

/** Postgres numeric puede llegar como string; se normaliza a number. */
function num<T extends object>(row: T, keys: (keyof T)[]): T {
  const out = { ...row };
  for (const k of keys) {
    const v = out[k] as unknown;
    if (v !== null && v !== undefined) (out as Record<keyof T, unknown>)[k] = Number(v);
  }
  return out;
}

async function unwrap<T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data as T;
}

export const qk = {
  settings: ['settings'] as const,
  debts: ['debts'] as const,
  payments: ['payments'] as const,
  checkins: ['checkins'] as const,
  incomes: ['incomes'] as const,
  fixed: ['fixed_expenses'] as const,
  fixedPayments: ['fixed_expense_payments'] as const,
  movements: ['savings_movements'] as const,
};

// ───────────── Lecturas ─────────────

export function useSettings() {
  return useQuery({
    queryKey: qk.settings,
    queryFn: async () => {
      const row = await unwrap<Settings | null>(supabase.from('settings').select('*').maybeSingle());
      return row
        ? num(row, [
            'monthly_income', 'decimo_tercero', 'decimo_cuarto', 'decimos_pct_to_debt', 'extra_monthly',
            'daily_living_budget', 'colchon_target', 'monthly_saving_target', 'abono_min',
            'abono_safety_pct', 'abono_round',
          ])
        : null;
    },
  });
}

export function useDebts() {
  return useQuery({
    queryKey: qk.debts,
    queryFn: async () => {
      const rows = await unwrap<Debt[]>(
        supabase.from('debts').select('*').order('payoff_priority').order('created_at'),
      );
      return rows.map((d) =>
        num(d, ['initial_balance', 'current_balance', 'annual_rate', 'monthly_payment', 'min_payment', 'one_off_first_month']),
      );
    },
  });
}

export function usePayments() {
  return useQuery({
    queryKey: qk.payments,
    queryFn: async () => {
      const rows = await unwrap<Payment[]>(
        supabase.from('payments').select('*').order('paid_on', { ascending: false }).order('created_at', { ascending: false }),
      );
      return rows.map((p) => num(p, ['amount', 'interest_part', 'principal_part']));
    },
  });
}

export function useCheckins() {
  return useQuery({
    queryKey: qk.checkins,
    queryFn: async () => {
      const rows = await unwrap<BalanceCheckin[]>(
        supabase.from('balance_checkins').select('*').order('checked_on', { ascending: false }).limit(120),
      );
      return rows.map((c) => num(c, ['balance']));
    },
  });
}

export function useIncomes() {
  return useQuery({
    queryKey: qk.incomes,
    queryFn: async () => {
      const rows = await unwrap<Income[]>(
        supabase.from('incomes').select('*').order('received_on', { ascending: false }).limit(200),
      );
      return rows.map((i) => num(i, ['amount']));
    },
  });
}

export function useFixedExpenses() {
  return useQuery({
    queryKey: qk.fixed,
    queryFn: async () => {
      const rows = await unwrap<FixedExpense[]>(supabase.from('fixed_expenses').select('*').order('created_at'));
      return rows.map((f) => num(f, ['amount']));
    },
  });
}

export function useFixedPayments() {
  return useQuery({
    queryKey: qk.fixedPayments,
    queryFn: async () => {
      const rows = await unwrap<FixedExpensePayment[]>(
        supabase.from('fixed_expense_payments').select('*').order('paid_on', { ascending: false }).limit(300),
      );
      return rows.map((f) => num(f, ['amount']));
    },
  });
}

export function useSavingsMovements() {
  return useQuery({
    queryKey: qk.movements,
    queryFn: async () => {
      const rows = await unwrap<SavingsMovement[]>(
        supabase.from('savings_movements').select('*').order('moved_on', { ascending: false }).limit(300),
      );
      return rows.map((m) => num(m, ['amount']));
    },
  });
}

// ───────────── Escrituras ─────────────

function useWrite<TVars>(fn: (v: TVars) => Promise<unknown>, invalidate: readonly (readonly string[])[]) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => Promise.all(invalidate.map((k) => qc.invalidateQueries({ queryKey: k }))),
  });
}

export type DebtDraft = Omit<Debt, 'id' | 'user_id' | 'created_at' | 'status'> & { status?: Debt['status'] };

export function useSaveDebt() {
  return useWrite(
    async ({ id, ...draft }: DebtDraft & { id?: string }) => {
      if (id) return unwrap(supabase.from('debts').update(draft).eq('id', id).select().single());
      return unwrap(supabase.from('debts').insert(draft).select().single());
    },
    [qk.debts],
  );
}

export function useDeleteDebt() {
  return useWrite((id: string) => unwrap(supabase.from('debts').delete().eq('id', id)), [qk.debts, qk.payments]);
}

export type PaymentDraft = Pick<Payment, 'debt_id' | 'paid_on' | 'amount' | 'kind' | 'interest_part' | 'principal_part'> & {
  note?: string | null;
};

export function useAddPayment() {
  return useWrite(
    (p: PaymentDraft) => unwrap(supabase.from('payments').insert(p).select().single()),
    [qk.payments, qk.debts],
  );
}

/** No se editan pagos: se borran y se vuelven a registrar (el trigger mantiene el saldo). */
export function useDeletePayment() {
  return useWrite((id: string) => unwrap(supabase.from('payments').delete().eq('id', id)), [qk.payments, qk.debts]);
}

export function useSaveCheckin() {
  return useWrite(
    (c: { user_id: string; checked_on: string; balance: number; note?: string | null }) =>
      unwrap(
        supabase
          .from('balance_checkins')
          .upsert(c, { onConflict: 'user_id,checked_on' })
          .select()
          .single(),
      ),
    [qk.checkins],
  );
}

export function useDeleteCheckin() {
  return useWrite((id: string) => unwrap(supabase.from('balance_checkins').delete().eq('id', id)), [qk.checkins]);
}

export function useAddIncome() {
  return useWrite(
    (i: Pick<Income, 'received_on' | 'amount' | 'kind'> & { note?: string | null }) =>
      unwrap(supabase.from('incomes').insert(i).select().single()),
    [qk.incomes],
  );
}

export function useDeleteIncome() {
  return useWrite((id: string) => unwrap(supabase.from('incomes').delete().eq('id', id)), [qk.incomes]);
}

export function useSaveFixedExpense() {
  return useWrite(
    async ({ id, ...f }: Pick<FixedExpense, 'name' | 'amount' | 'due_day' | 'active'> & { id?: string }) => {
      if (id) return unwrap(supabase.from('fixed_expenses').update(f).eq('id', id).select().single());
      return unwrap(supabase.from('fixed_expenses').insert(f).select().single());
    },
    [qk.fixed],
  );
}

export function useDeleteFixedExpense() {
  return useWrite(
    (id: string) => unwrap(supabase.from('fixed_expenses').delete().eq('id', id)),
    [qk.fixed, qk.fixedPayments],
  );
}

export function useAddFixedPayment() {
  return useWrite(
    (p: Pick<FixedExpensePayment, 'expense_id' | 'month' | 'paid_on' | 'amount'>) =>
      unwrap(supabase.from('fixed_expense_payments').insert(p).select().single()),
    [qk.fixedPayments],
  );
}

export function useDeleteFixedPayment() {
  return useWrite(
    (id: string) => unwrap(supabase.from('fixed_expense_payments').delete().eq('id', id)),
    [qk.fixedPayments],
  );
}

export function useSaveSettings() {
  return useWrite(
    (s: Partial<Settings> & { user_id: string }) =>
      unwrap(
        supabase
          .from('settings')
          .upsert({ ...s, updated_at: new Date().toISOString() })
          .select()
          .single(),
      ),
    [qk.settings],
  );
}
