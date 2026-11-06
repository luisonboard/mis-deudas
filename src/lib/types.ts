export type DebtKind = 'loan' | 'revolving' | 'fixed_installments';
export type DebtStatus = 'active' | 'paid' | 'archived';
export type PaymentKind = 'regular' | 'extra' | 'fee';
export type IncomeKind = 'salary' | 'decimo_tercero' | 'decimo_cuarto' | 'other';

export interface Settings {
  user_id: string;
  monthly_income: number;
  decimo_tercero: number;
  decimo_cuarto: number;
  decimos_pct_to_debt: number;
  extra_monthly: number;
  extra_start_month: string | null;
  payday_rule: 'last_day' | 'fixed_day';
  payday_day: number | null;
  daily_living_budget: number;
  colchon_target: number;
  monthly_saving_target: number;
  abono_min: number;
  abono_safety_pct: number;
  abono_round: number;
  timezone: string;
  updated_at: string;
}

export interface Debt {
  id: string;
  user_id: string;
  name: string;
  lender: string | null;
  kind: DebtKind;
  initial_balance: number;
  current_balance: number;
  annual_rate: number;
  monthly_payment: number;
  min_payment: number | null;
  term_months: number | null;
  first_payment_date: string | null;
  due_day: number | null;
  payoff_priority: number;
  one_off_first_month: number;
  status: DebtStatus;
  notes: string | null;
  created_at: string;
}

export interface Payment {
  id: string;
  user_id: string;
  debt_id: string;
  paid_on: string;
  amount: number;
  kind: PaymentKind;
  interest_part: number;
  principal_part: number;
  note: string | null;
  created_at: string;
}

export interface BalanceCheckin {
  id: string;
  user_id: string;
  checked_on: string;
  balance: number;
  note: string | null;
  created_at: string;
}

export interface Income {
  id: string;
  user_id: string;
  received_on: string;
  amount: number;
  kind: IncomeKind;
  note: string | null;
  created_at: string;
}

export interface FixedExpense {
  id: string;
  user_id: string;
  name: string;
  amount: number;
  due_day: number | null;
  active: boolean;
  created_at: string;
}

export interface FixedExpensePayment {
  id: string;
  user_id: string;
  expense_id: string;
  month: string;
  paid_on: string;
  amount: number;
  created_at: string;
}

export interface SavingsMovement {
  id: string;
  user_id: string;
  goal_id: string;
  moved_on: string;
  amount: number;
  from_main_account: boolean;
  note: string | null;
  created_at: string;
}

export const DEBT_KIND_LABEL: Record<DebtKind, string> = {
  loan: 'Préstamo',
  revolving: 'Tarjeta (rotativo)',
  fixed_installments: 'Cuotas fijas',
};

export const INCOME_KIND_LABEL: Record<IncomeKind, string> = {
  salary: 'Sueldo',
  decimo_tercero: 'Décimo tercero',
  decimo_cuarto: 'Décimo cuarto',
  other: 'Otro',
};

export const PAYMENT_KIND_LABEL: Record<PaymentKind, string> = {
  regular: 'Regular',
  extra: 'Abono extra',
  fee: 'Cargo / comisión',
};
