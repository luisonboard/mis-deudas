-- Mis Deudas · migración inicial
-- Correr completo en Supabase → SQL Editor.

create extension if not exists "pgcrypto";

-- Ajustes del usuario (una fila por usuario)
create table public.settings (
  user_id uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  monthly_income numeric(12,2) not null default 0,
  decimo_tercero numeric(12,2) not null default 0,
  decimo_cuarto numeric(12,2) not null default 482,
  decimos_pct_to_debt numeric(5,4) not null default 0.5 check (decimos_pct_to_debt between 0 and 1),
  extra_monthly numeric(12,2) not null default 0,
  extra_start_month date,                 -- primer mes en que se aplica el abono extra
  payday_rule text not null default 'last_day' check (payday_rule in ('last_day', 'fixed_day')),
  payday_day smallint check (payday_day between 1 and 31),   -- solo si payday_rule = 'fixed_day'
  daily_living_budget numeric(12,2) not null default 12.50,   -- tope diario base (comida, transporte, celular, salud)
  colchon_target numeric(12,2) not null default 300,
  monthly_saving_target numeric(12,2) not null default 100,
  abono_min numeric(12,2) not null default 20,                -- no recomendar abonos menores
  abono_safety_pct numeric(5,4) not null default 0.2,         -- margen de seguridad sobre el sobrante
  abono_round numeric(6,2) not null default 5,                -- redondear el abono hacia abajo a múltiplos de este valor
  timezone text not null default 'America/Guayaquil',
  updated_at timestamptz not null default now()
);

create type public.debt_kind as enum ('loan', 'revolving', 'fixed_installments');
create type public.debt_status as enum ('active', 'paid', 'archived');

create table public.debts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  lender text,
  kind public.debt_kind not null,
  initial_balance numeric(12,2) not null check (initial_balance >= 0),
  current_balance numeric(12,2) not null check (current_balance >= 0),
  annual_rate numeric(7,4) not null default 0,       -- nominal anual en fracción: 0.156 = 15,6 %
  monthly_payment numeric(12,2) not null default 0,   -- cuota fija (loan, fixed_installments)
  min_payment numeric(12,2),                          -- pago mínimo (revolving)
  term_months int,
  first_payment_date date,
  due_day smallint check (due_day between 1 and 31),
  payoff_priority smallint not null default 100,      -- menor número = recibe antes los abonos extra
  one_off_first_month numeric(12,2) not null default 0, -- "cargo único" del mes 1 (p. ej. 18,85 de exigibles); no es capital
  status public.debt_status not null default 'active',
  notes text,
  created_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  debt_id uuid not null references public.debts(id) on delete cascade,
  paid_on date not null,
  amount numeric(12,2) not null check (amount > 0),
  kind text not null check (kind in ('regular', 'extra', 'fee')),
  interest_part numeric(12,2) not null default 0,
  principal_part numeric(12,2) not null default 0,
  note text,
  created_at timestamptz not null default now(),
  check (interest_part + principal_part <= amount + 0.005)
);
create index payments_debt_idx on public.payments(debt_id, paid_on);

create table public.savings_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  target_amount numeric(12,2) not null default 0,
  priority smallint not null default 100,
  created_at timestamptz not null default now()
);

create table public.savings_movements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  goal_id uuid not null references public.savings_goals(id) on delete cascade,
  moved_on date not null,
  amount numeric(12,2) not null check (amount <> 0),  -- positivo = ahorro, negativo = retiro
  from_main_account boolean not null default true,    -- true = el dinero sale de (o vuelve a) la cuenta principal
  note text,
  created_at timestamptz not null default now()
);

-- Saldo de la cuenta que el usuario ingresa (máximo uno por día)
create table public.balance_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  checked_on date not null,
  balance numeric(12,2) not null,
  note text,
  created_at timestamptz not null default now(),
  unique (user_id, checked_on)
);

-- Ingresos: sueldo, décimos y otros
create table public.incomes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  received_on date not null,
  amount numeric(12,2) not null check (amount > 0),
  kind text not null check (kind in ('salary', 'decimo_tercero', 'decimo_cuarto', 'other')),
  note text,
  created_at timestamptz not null default now()
);

-- Gastos fijos (plantillas) y sus pagos mensuales
create table public.fixed_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  amount numeric(12,2) not null check (amount >= 0),
  due_day smallint check (due_day between 1 and 31),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.fixed_expense_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  expense_id uuid not null references public.fixed_expenses(id) on delete cascade,
  month date not null check (month = date_trunc('month', month)::date),  -- primer día del mes que se paga
  paid_on date not null,
  amount numeric(12,2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique (expense_id, month)
);

create view public.savings_goal_balances with (security_invoker = true) as
select g.*, coalesce(sum(m.amount), 0)::numeric(12,2) as balance
from public.savings_goals g
left join public.savings_movements m on m.goal_id = g.id
group by g.id;

-- Mantener current_balance al registrar o borrar pagos
create or replace function public.apply_payment() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.debts
       set current_balance = greatest(current_balance - new.principal_part, 0),
           status = case when current_balance - new.principal_part <= 0.005 then 'paid'::public.debt_status else status end
     where id = new.debt_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.debts
       set current_balance = current_balance + old.principal_part,
           status = case when status = 'paid' then 'active'::public.debt_status else status end
     where id = old.debt_id;
    return old;
  end if;
  return null;
end $$;

create trigger payments_apply after insert or delete on public.payments
for each row execute function public.apply_payment();

-- Row Level Security: cada usuario solo ve y modifica sus filas
alter table public.settings              enable row level security;
alter table public.debts                 enable row level security;
alter table public.payments              enable row level security;
alter table public.savings_goals         enable row level security;
alter table public.savings_movements     enable row level security;
alter table public.balance_checkins      enable row level security;
alter table public.incomes               enable row level security;
alter table public.fixed_expenses        enable row level security;
alter table public.fixed_expense_payments enable row level security;

create policy own_settings on public.settings for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_debts on public.debts for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_goals on public.savings_goals for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_payments on public.payments for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid()
    and exists (select 1 from public.debts d where d.id = debt_id and d.user_id = auth.uid()));
create policy own_movements on public.savings_movements for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid()
    and exists (select 1 from public.savings_goals g where g.id = goal_id and g.user_id = auth.uid()));
create policy own_checkins on public.balance_checkins for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_incomes on public.incomes for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_fixed on public.fixed_expenses for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_fixed_payments on public.fixed_expense_payments for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid()
    and exists (select 1 from public.fixed_expenses f where f.id = expense_id and f.user_id = auth.uid()));

-- Permisos explícitos: solo usuarios autenticados usan la API; anon no ve nada.
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
