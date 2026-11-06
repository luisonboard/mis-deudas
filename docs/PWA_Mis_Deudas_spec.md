# PWA "Mis Deudas": seguimiento de deudas, ahorros y abonos

Especificación para construir la app con **Vite + React + TypeScript**, **Supabase** (Auth + Postgres + RLS) y **Cloudflare Pages**. Está escrita para pasársela completa a Claude Code o para seguirla a mano.

> **Prompt inicial para Claude Code:** "Lee `PWA_Mis_Deudas_spec.md` y construye la app por fases, empezando por la Fase 1. Al terminar cada fase, corre `npm run test` y `npm run build`, y muéstrame qué falta. No inventes requisitos que no estén en el documento; si algo es ambiguo, pregúntame."

---

## 1. Objetivo

App personal (un solo usuario) para responder tres preguntas en menos de 5 segundos:

1. **¿Cuándo termino de pagar?** Fecha libre de deudas.
2. **¿Cuánto pagaré en total?** Capital, interés y total proyectado.
3. **¿Cómo voy?** Lo pagado, los abonos extra, lo ahorrado y cuánto interés ahorro por abonar más.

Funciones: registrar deudas, pagos y abonos extra; simular escenarios de abono; llevar metas de ahorro (colchón, fondo de mudanza). Funciona en el celular como app instalada y muestra los últimos datos sin internet.

**Seguimiento diario (función central).** Cada día, o cada pocos días, el usuario ingresa **el saldo de su cuenta** y registra los pagos que hizo a las tarjetas y a los gastos fijos. Con eso la app:

- Estima cuánto gastó en el día a día: `gasto estimado = saldo anterior + ingresos − pagos registrados − saldo actual`. No se piden gastos exactos, porque el objetivo es **minimizarlos**. La app muestra un **tope diario**.
- Dice **cuánto conviene abonar hoy a las tarjetas** sin quedarse corto antes del próximo sueldo (sección 5.5).
- Recalcula la fecha libre de deudas con lo que realmente se abonó.

**Fuera de alcance (v1):** multiusuario, conexión con bancos, scraping de estados de cuenta, notificaciones push, control de gastos por categoría (la app solo estima el gasto total diario a partir del saldo).

## 2. Stack

| Capa | Elección | Motivo |
|---|---|---|
| UI | React 18 + TypeScript + Vite | Stack JS/TS habitual |
| Estilos | Tailwind CSS | Rápido y responsive |
| Estado de servidor | TanStack Query | Caché y reintentos |
| Validación | Zod | Mismos tipos en formularios y datos |
| Gráficos | Recharts | Línea de saldo y barras de pagos |
| PWA | `vite-plugin-pwa` (Workbox) | Manifest, service worker, actualización automática |
| Backend | Supabase (Postgres, Auth, RLS) | Sin servidor propio |
| Hosting | Cloudflare Pages | HTTPS, CDN, despliegue por Git |
| Pruebas | Vitest + Testing Library | Los cálculos se prueban sin UI |

Los cálculos corren **en el navegador** como funciones puras. No hace falta Edge Function ni Worker.

## 3. Arquitectura

```
Celular / PC ── PWA (Cloudflare Pages, estático)
                 │  supabase-js (solo clave anon)
                 ▼
              Supabase: Auth (email + contraseña, sin registro público)
                        Postgres + RLS (cada fila = auth.uid())
```

- **Sin secretos en el cliente.** Solo `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`. Nunca uses la `service_role` en el front.
- **Caché sin conexión:** el service worker guarda la app y las respuestas GET de Supabase con `NetworkFirst`. Sin conexión, se ve el último estado y los formularios de escritura se deshabilitan con un aviso (v1). Una cola de escrituras pendientes en IndexedDB queda para la Fase 5.
- **Zona horaria:** `America/Guayaquil` para fechas de pago y mes actual.
- **Moneda:** USD, formato `es-EC` (`$1.234,56`).

## 4. Modelo de datos (migración SQL)

Guárdala como `supabase/migrations/0001_init.sql` y córrela en el SQL Editor de Supabase.

```sql
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
language plpgsql security invoker as $$
begin
  if tg_op = 'INSERT' then
    update public.debts
       set current_balance = greatest(current_balance - new.principal_part, 0),
           status = case when current_balance - new.principal_part <= 0.005 then 'paid' else status end
     where id = new.debt_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.debts
       set current_balance = current_balance + old.principal_part,
           status = case when status = 'paid' then 'active' else status end
     where id = old.debt_id;
    return old;
  end if;
  return null;
end $$;

create trigger payments_apply after insert or delete on public.payments
for each row execute function public.apply_payment();

-- Row Level Security: cada usuario solo ve y modifica sus filas
alter table public.settings         enable row level security;
alter table public.debts            enable row level security;
alter table public.payments         enable row level security;
alter table public.savings_goals    enable row level security;
alter table public.savings_movements enable row level security;
alter table public.balance_checkins  enable row level security;
alter table public.incomes           enable row level security;
alter table public.fixed_expenses    enable row level security;
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
```

No se editan pagos: para corregir uno, se borra y se vuelve a registrar (así el trigger mantiene el saldo).

### Datos iniciales (opcional)

Crea tu usuario en Supabase (ver sección 9) y luego corre esto cambiando el correo. **Revisa cada cifra con tus estados de cuenta antes de usarla.**

```sql
do $$
declare uid uuid := (select id from auth.users where email = 'TU_CORREO@ejemplo.com');
begin
  insert into public.settings (user_id, monthly_income, decimo_tercero, decimo_cuarto, decimos_pct_to_debt, extra_monthly, extra_start_month,
                               payday_rule, daily_living_budget, colchon_target, monthly_saving_target)
  values (uid, 1413.65, 1413.65, 482, 0.5, 300, '2026-11-01', 'last_day', 12.50, 300, 100);

  insert into public.debts (user_id, name, lender, kind, initial_balance, current_balance, annual_rate, monthly_payment, min_payment, term_months, first_payment_date, due_day, payoff_priority, notes) values
  (uid, 'Produbanco (novación 36 meses)', 'Produbanco', 'loan',               6681.25, 6681.25, 0.156, 233.58, null,  36,   '2026-11-16', 16, 20, 'La 1ª cuota lleva +18,85 de exigibles'),
  (uid, 'Diners Titanium',               'Diners Club', 'revolving',           579.47,  579.47, 0.156, 0,      46.44, null, '2026-12-05',  5, 10, 'Incluye diferido de 6 cuotas de 20,83'),
  (uid, 'Diners Discover',               'Diners Club', 'fixed_installments', 1499.58, 1499.58, 0,     166.62, null,    9, '2026-12-05',  5, 30, '9 cuotas fijas; el interés ya está en la cuota');

  insert into public.savings_goals (user_id, name, target_amount, priority) values
  (uid, 'Colchón de imprevistos', 300, 10),
  (uid, 'Fondo de mudanza', 500, 20);

  insert into public.fixed_expenses (user_id, name, amount, due_day) values
  (uid, 'Pensión del hijo', 50, null),
  (uid, 'Electricidad',     50, null),
  (uid, 'Internet',         25, null),
  (uid, 'Agua',             10, null);
end $$;
```

## 5. Reglas de cálculo (módulo `src/lib/finance`)

Todo es función pura y se prueba con Vitest. Se calcula con `number` y se redondea a centavos solo al mostrar.

### 5.1 Cuota de un préstamo

```ts
export const monthlyRate = (annual: number) => annual / 12;

export function pmt(principal: number, annualRate: number, months: number): number {
  const r = monthlyRate(annualRate);
  return r === 0 ? principal / months : (principal * r) / (1 - Math.pow(1 + r, -months));
}
```

### 5.2 Cronograma de amortización

Para una deuda `loan`: en cada mes `interés = saldo × r`, `pago = min(cuota, saldo + interés)`, `capital = pago − interés`, `saldo = saldo − capital`.

### 5.3 Simulación del plan (lógica exacta)

Debe coincidir con el Excel `Plan_dinero_Luis.xlsx`. Reglas, mes a mes, empezando en el mes 1 (noviembre de 2026):

1. **Interés:** para `loan` y `revolving`, `interés = saldo × tasa_anual / 12`. Las `fixed_installments` no tienen interés explícito (ya está en la cuota).
2. **Pago base:**
   - `loan`: `min(cuota, saldo + interés)` desde el mes 1.
   - `revolving`: `min(pago_mínimo, saldo + interés)` desde el mes 2 (el mes 1 ya se pagó el 5-nov). El interés se acumula igual en el mes 1.
   - `fixed_installments`: `min(cuota, saldo)` desde el mes 2.
3. **Extra del mes:** `extra_mensual` desde `extra_start_index` (por defecto 1: el sueldo llega el último día de cada mes y ese mismo día se abona), más `décimo_tercero × pct` en diciembre, más `décimo_cuarto × pct` en marzo.
4. **Cascada del extra:** se aplica por `payoff_priority` ascendente, solo a deudas `loan` y `revolving` (cada una hasta `saldo + interés − pago_base`). Con los datos iniciales: primero Titanium (10) y luego Produbanco (20). Las cuotas fijas no reciben extra.
5. **Cargo único:** `+18,85` en el mes 1 (exigibles de la primera cuota). Se suma al total pagado, no al capital. Debe ser configurable como "cargo único" en el mes 1 de una deuda.
6. **Fin:** el mes en que la deuda total llega a ≤ 0,005. El resultado incluye `mesesHastaCero`, `fechaLibre`, `interesTotal` (solo `loan` + `revolving`), `totalPagado` (todo) y la serie mensual de saldos por deuda.

```ts
export interface DebtInput {
  id: string; name: string;
  kind: 'loan' | 'revolving' | 'fixed_installments';
  balance: number; annualRate: number;
  monthlyPayment: number; minPayment?: number | null;
  payoffPriority: number;
  firstPayMonthIndex: number;      // 1 = mes de inicio de la simulación
  oneOffFirstMonth?: number;       // 18.85 en Produbanco
}
export interface PlanInput {
  startMonth: string;              // '2026-11'
  debts: DebtInput[];
  extraMonthly: number; extraStartIndex: number;  // 1
  decimoTercero: number; decimoCuarto: number; decimosPct: number;
  maxMonths: number;               // 84
}
export interface MonthRow {
  index: number; month: string;
  perDebt: Record<string, { interest: number; base: number; extra: number; balanceEnd: number }>;
  totalPaid: number; totalDebtEnd: number;
}
export interface PlanResult {
  months: MonthRow[]; monthsToZero: number | null; debtFreeMonth: string | null;
  totalInterest: number; totalPaid: number;
}
export function simulatePlan(input: PlanInput): PlanResult { /* implementar según 5.3 */ }
```

La pantalla del simulador corre `simulatePlan` dos veces: con el plan del usuario y en "base" (`extraMonthly = 0`, sin décimos), y muestra la diferencia en meses e interés.

### 5.4 Vectores de prueba (deben pasar)

| Prueba | Entrada | Resultado esperado (tolerancia ±0,01) |
|---|---|---|
| `pmt` | 6.681,25 · 0,156 · 36 meses | **233,58** |
| Total a pagar de la novación | 36 × 233,58 | 8.408,88; interés ≈ 1.727,6 |
| Plan base (con los datos iniciales, sin extra ni décimos) | `extraMonthly = 0`, `decimos = 0` | **36 meses**, libre en **oct-2029**, interés **1.793,41**, total pagado **10.572,56** |
| Plan con abono | `extraMonthly = 300` desde el mes 1, décimos 50 % (dic: 706,825; mar: 241) | **13 meses**, libre en **nov-2027**, interés **618,55**, total pagado **9.397,70** |
| Saldo al pagar | Registrar un pago extra de 100 a Titanium con 20 de interés | `current_balance` baja 80 (no 100) |
| Borrar pago | Eliminar ese pago | `current_balance` vuelve al valor anterior |
| RLS | Usuario B consulta filas del usuario A | 0 filas |

### 5.5 Seguimiento diario y recomendador de abonos

**Gasto estimado entre dos check-ins** (`checked_on` consecutivos):

```
gastoEstimado = saldoAnterior + ingresos(entre ambas fechas) − pagosDeDeuda − pagosGastosFijos − ahorrosQueSalenDeLaCuenta − saldoActual
```

Se muestra por día (`gastoEstimado / díasTranscurridos`) y se compara con el tope diario. Un resultado negativo indica un ingreso o un pago sin registrar y la app lo avisa.

**Recomendación de abono.** Función pura `recommend(input)`:

```ts
export interface RecoInput {
  today: string;                  // 'YYYY-MM-DD' en America/Guayaquil
  balance: number;                // saldo de hoy ingresado por el usuario
  nextPayday: string;             // último día del mes; si hoy ya se registró el sueldo, el último día del mes siguiente
  pending: { name: string; due: string; amount: number }[];  // gastos fijos y pagos de tarjetas aún no registrados como pagados
  dailyLivingBudget: number;      // 12.50
  colchonTarget: number;          // 300
  savingPendingThisCycle: number; // 100 si todavía no se apartó el ahorro de este ciclo
  abonoMin: number; abonoSafetyPct: number; abonoRound: number;
}
```

Reglas:

1. `D = días entre today y nextPayday` (mínimo 1).
2. `obligaciones = Σ pending con due < nextPayday` (lo que vence el mismo día del sueldo se paga con el sueldo).
3. `gastoVida = D × dailyLivingBudget`.
4. `sobranteSeguro = balance − obligaciones − gastoVida − colchonTarget − savingPendingThisCycle`. El colchón se mantiene dentro de la cuenta.
5. Si `sobranteSeguro < 0`: abono = 0, `deficit = −sobranteSeguro` y la app muestra "Gasta como máximo `topeDiario`/día" con aviso rojo si ese tope queda por debajo del tope planificado.
6. Si no: `bruto = sobranteSeguro × (1 − abonoSafetyPct)`, `abono = floor(bruto / abonoRound) × abonoRound`, y si `abono < abonoMin` entonces `abono = 0`.
7. `topeDiario = (balance − obligaciones − colchonTarget − savingPendingThisCycle − abono) / D`.
8. **A qué tarjeta:** por `payoff_priority` ascendente entre deudas `loan` y `revolving`, hasta su saldo. Con los datos iniciales, primero Titanium y luego Produbanco (pedir al banco reducir plazo, no cuota). Las cuotas fijas (Discover) no reciben abonos extra.
9. **Explicación:** la pantalla muestra siempre el desglose (saldo, obligaciones, gasto de vida, colchón, ahorro, margen de seguridad) en 3 a 5 líneas.
10. **Décimos:** al registrar un ingreso `decimo_tercero` o `decimo_cuarto`, se sugiere `monto × decimos_pct_to_debt` como abono (sin margen de seguridad) y el resto va primero al colchón y luego al ahorro.
11. **Día de cobro:** si hoy es el último día del mes, la pantalla pregunta "¿Ya te depositaron el sueldo?" y, al registrarlo, calcula la recomendación del nuevo ciclo.

**Vectores de prueba del recomendador (±0,01):**

| Caso | Entrada | Resultado |
|---|---|---|
| 6-nov-2026 | balance 963,66 · pendientes: pensión 50, luz 50, Produbanco 252,43 (16-nov) · `nextPayday` 30-nov (D = 24) · tope base 12,50 · colchón 300 · ahorro pendiente 0 | `sobranteSeguro` **11,23** · abono **0** · `topeDiario` **12,97** |
| 30-nov-2026, sueldo registrado | balance 1.724,88 · pendientes antes del 31-dic: Diners 213,06 (5-dic), Produbanco 233,58 (16-dic), pensión 50, luz 50, internet 25, agua 10 · D = 31 · ahorro pendiente 100 | `sobranteSeguro` **355,74** · abono **280** (80 % = 284,59 redondeado a 5) · `topeDiario` **14,94** |
| Gasto estimado | check-in 6-nov: 963,66; 7-nov: 951,16; sin pagos ni ingresos | `gastoEstimado` **12,50** |

## 6. Pantallas

Diseño mobile-first, barra inferior con 5 pestañas. Español de Ecuador, `$` con dos decimales.

1. **Hoy (pantalla principal)**
   - **Check-in diario:** campo para el saldo de hoy (prellenado con el último) y botón Guardar. Debajo, accesos rápidos: *Registrar pago de tarjeta*, *Registrar gasto fijo pagado* y *Registrar ingreso* (sueldo o décimo).
   - **Recomendación del día** (sección 5.5): abono sugerido, a qué tarjeta, tope diario, obligaciones pendientes hasta el próximo sueldo y el porqué en pocas líneas.
   - **Gasto de la semana:** gasto estimado de los últimos 7 días contra el tope (barra verde o roja) y racha de días bajo el tope.
   - Tarjeta grande: **"Libre de deudas en {mes año} · faltan {n} meses"** (plan del usuario), y debajo "sin abonos extra: {mes año}".
   - Tres cifras: Deuda actual, Interés proyectado restante, Total a pagar restante.
   - Barra de progreso: pagado de capital ÷ deuda inicial.
   - "Próximo pago": deuda, fecha y monto, con cuenta regresiva.
   - Ahorro: colchón y fondo de mudanza con su barra de meta.
   - Gráfico de línea: deuda total proyectada vs. base.
2. **Deudas**
   - Lista con saldo, cuota, tasa, % pagado y fecha estimada de fin.
   - Detalle: cronograma de amortización, historial de pagos y botón **"Registrar pago"** (tipo `regular` o `extra`, fecha, monto). El interés del pago se sugiere con `saldo × tasa / 12` y se puede editar.
   - Alta y edición de deudas (con validación Zod). Marcar como "pagada" es automático cuando el saldo llega a 0.
3. **Simulador**
   - Controles: abono extra mensual (slider $0–$600), % de décimos a deuda (0–100 %), mes de inicio del extra, orden de prioridad.
   - Resultado en vivo: fecha libre, meses, interés, total pagado, ahorro vs. base. Se pueden guardar los valores como "mi plan" (actualiza `settings`).
4. **Ahorros**
   - Metas con saldo, objetivo y barra. Movimientos (ahorrar o retirar) con fecha y nota.
   - Regla visible: "Primero el colchón de $300, luego el extra a deuda".
5. **Ajustes**
   - Sueldo y regla de cobro (último día del mes), décimos, tope diario de gasto, colchón objetivo, ahorro mensual, parámetros del recomendador (mínimo, margen de seguridad, redondeo), zona horaria, cerrar sesión, **exportar CSV** (deudas, pagos, ahorros) y **exportar calendario `.ics`** con los próximos pagos para recordatorios del celular.

Estados vacíos, de carga y de error en todas las pantallas. Accesibilidad básica: contraste AA, tamaños táctiles de 44 px, etiquetas en formularios.

## 7. Estructura del proyecto

```
mis-deudas/
├─ public/
│  ├─ _headers            # CSP y seguridad (sección 8)
│  ├─ _redirects          # /*  /index.html  200
│  └─ icons/              # 192, 512 y maskable
├─ supabase/migrations/0001_init.sql
├─ src/
│  ├─ main.tsx · App.tsx · routes.tsx
│  ├─ lib/
│  │  ├─ supabase.ts      # createClient con las variables VITE_*
│  │  ├─ format.ts        # Intl.NumberFormat('es-EC', USD), fechas
│  │  └─ finance/         # pmt.ts · schedule.ts · simulate.ts · *.test.ts
│  ├─ features/
│  │  ├─ auth/ · dashboard/ · debts/ · simulator/ · savings/ · settings/
│  │  └─ export/          # csv.ts · ics.ts
│  └─ components/         # Card, ProgressBar, MoneyInput, Chart, TabBar
├─ vite.config.ts · tailwind.config.ts · tsconfig.json
└─ package.json
```

## 8. PWA y seguridad

**`vite.config.ts` (fragmento):**

```ts
import { VitePWA } from 'vite-plugin-pwa';

VitePWA({
  registerType: 'autoUpdate',
  manifest: {
    name: 'Mis Deudas', short_name: 'Deudas', lang: 'es',
    start_url: '/', display: 'standalone',
    background_color: '#0f172a', theme_color: '#0f172a',
    icons: [
      { src: '/icons/192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  },
  workbox: {
    navigateFallback: '/index.html',
    runtimeCaching: [{
      urlPattern: ({ url }) => url.hostname.endsWith('.supabase.co') && url.pathname.startsWith('/rest/v1/'),
      handler: 'NetworkFirst',
      options: { cacheName: 'supabase-rest', networkTimeoutSeconds: 4, expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 14 } },
    }],
  },
})
```

**`public/_headers`:**

```
/*
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://*.supabase.co wss://*.supabase.co; frame-ancestors 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), microphone=(), geolocation=()
```

**Reglas de seguridad:**

- RLS activo en todas las tablas (ya incluido). Probar con un segundo usuario de prueba.
- **No guardes números de tarjeta, cédula ni contraseñas bancarias.** Solo nombres de deudas y montos.
- Desactivar el registro público en Supabase (ver sección 9).
- Contraseña larga y única; opcionalmente activar MFA en Supabase.
- Capa extra opcional: proteger el dominio con **Cloudflare Access** (Zero Trust, plan gratuito) con un correo permitido.
- Respaldos: Supabase hace respaldos diarios en planes de pago; en el gratuito usa **Exportar CSV** cada mes.

## 9. Configuración paso a paso

**Supabase**

1. Crea un proyecto en supabase.com (región cercana, por ejemplo São Paulo o US East).
2. SQL Editor → pega y ejecuta `0001_init.sql`.
3. Authentication → Providers → Email: activa email + contraseña. En Authentication → Sign In / Providers, **desactiva "Allow new users to sign up"**.
4. Authentication → Users → **Add user** con tu correo y una contraseña fuerte (marca "Auto confirm").
5. SQL Editor → corre el bloque de datos iniciales con tu correo (revisa cada cifra).
6. Project Settings → API → copia `Project URL` y la clave `anon public`.

**Local**

```bash
npm create vite@latest mis-deudas -- --template react-ts
cd mis-deudas
npm i @supabase/supabase-js @tanstack/react-query zod react-hook-form recharts react-router-dom
npm i -D tailwindcss postcss autoprefixer vite-plugin-pwa vitest @testing-library/react jsdom
echo "VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co" >> .env.local
echo "VITE_SUPABASE_ANON_KEY=TU_CLAVE_ANON" >> .env.local
npm run dev
```

`.env.local` va en `.gitignore`.

**Cloudflare Pages**

1. Sube el repo a GitHub (privado).
2. Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git.
3. Framework: Vite · Build command: `npm run build` · Output directory: `dist`.
4. Variables de entorno (Production y Preview): `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`.
5. Despliega. Cada `git push` a `main` publica solo.
6. En Supabase → Authentication → URL Configuration, agrega tu dominio `*.pages.dev` (o el propio) en Site URL.
7. En el celular: abre la URL en Chrome → menú → **Instalar app**.

## 10. Fases de entrega

| Fase | Contenido | Listo cuando |
|---|---|---|
| 1 | Proyecto, Auth, migración, CRUD de deudas, registrar pagos, check-in diario de saldo, gastos fijos e ingresos, pantalla Hoy básica | Puedes iniciar sesión, ver tus 3 deudas, ingresar el saldo del día y registrar un pago que baja el saldo |
| 2 | `simulatePlan`, `recommend`, pruebas 5.4 y 5.5, Simulador, gráfico y comparación con base | Los vectores de 5.4 y 5.5 pasan y la pantalla Hoy muestra el abono sugerido, la fecha libre y el interés |
| 3 | Ahorros, metas y movimientos | El colchón y el fondo de mudanza muestran saldo y avance |
| 4 | PWA instalable, caché sin conexión, `_headers`, despliegue en Cloudflare | Lighthouse PWA en verde y la app abre sin internet con el último estado |
| 5 | Exportar CSV y `.ics`, cola de escrituras sin conexión | Descargas el calendario de pagos y puedes registrar un pago sin señal |

## 11. Criterios de aceptación

- Al registrar un pago regular de la novación con interés sugerido, el saldo baja solo por el capital, y la fecha libre de deudas se recalcula.
- Mover el slider del abono extra de $0 a $300 cambia la fecha de **oct-2029** a **nov-2027** con los datos iniciales.
- Con saldo de $963,66 el 6-nov-2026 y los pendientes de la sección 5.5, la app recomienda abonar $0 y muestra un tope diario de $12,97.
- Al registrar el sueldo del 30-nov y un saldo de $1.724,88, la app sugiere abonar $280 a Titanium.
- Un check-in con saldo menor al esperado muestra el gasto estimado del día y lo compara con el tope.
- Con la sesión cerrada, ninguna tabla devuelve datos (RLS).
- Con otro usuario autenticado, no se ve ninguna fila del usuario original.
- La app instalada abre en modo `standalone` y muestra el último estado sin conexión.
- `npm run test` y `npm run build` pasan sin errores ni advertencias de tipos.

## 12. Supuestos que debes confirmar antes de usar los números

- Sueldo de $1.413,65 depositado el **último día de cada mes** (el próximo, el 30-nov-2026).
- Mínimos de Diners de noviembre ya pagados (Titanium $46,44 y Discover $166,62): saldo de Titanium $579,47 y 9 cuotas de Discover de $166,62 (dic-2026 a ago-2027).
- Produbanco: novación de $6.681,25 a 36 meses con cuota de $233,58 según su correo; la primera cuota vence el 16-nov-2026 con $18,85 adicionales.
- Los gastos de vida no son exactos. El tope diario inicial es de $12,50 ($375 al mes) y se ajusta con el gasto estimado real de los check-ins.
- Décimo tercero en diciembre (estimado en un sueldo) y 50 % de los décimos destinado a deuda. Décimo cuarto de $482 en marzo.
- Los mínimos de Titanium y Discover cambian cada mes; actualízalos al registrar cada estado de cuenta.
