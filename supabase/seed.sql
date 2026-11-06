-- Datos iniciales (opcional). Cambia el correo y REVISA cada cifra con tus estados de cuenta.
do $$
declare uid uuid := (select id from auth.users where email = 'TU_CORREO@ejemplo.com');
begin
  if uid is null then
    raise exception 'No existe un usuario con ese correo. Créalo primero en Authentication → Users.';
  end if;

  insert into public.settings (user_id, monthly_income, decimo_tercero, decimo_cuarto, decimos_pct_to_debt, extra_monthly, extra_start_month,
                               payday_rule, daily_living_budget, colchon_target, monthly_saving_target)
  values (uid, 1413.65, 1413.65, 482, 0.5, 300, '2026-11-01', 'last_day', 12.50, 300, 100);

  insert into public.debts (user_id, name, lender, kind, initial_balance, current_balance, annual_rate, monthly_payment, min_payment, term_months, first_payment_date, due_day, payoff_priority, one_off_first_month, notes) values
  (uid, 'Produbanco (novación 36 meses)', 'Produbanco', 'loan',               6681.25, 6681.25, 0.156, 233.58, null,  36,   '2026-11-16', 16, 20, 18.85, 'La 1ª cuota lleva +18,85 de exigibles'),
  (uid, 'Diners Titanium',               'Diners Club', 'revolving',           579.47,  579.47, 0.156, 0,      46.44, null, '2026-12-05',  5, 10, 0,     'Incluye diferido de 6 cuotas de 20,83'),
  (uid, 'Diners Discover',               'Diners Club', 'fixed_installments', 1499.58, 1499.58, 0,     166.62, null,    9, '2026-12-05',  5, 30, 0,     '9 cuotas fijas; el interés ya está en la cuota');

  insert into public.savings_goals (user_id, name, target_amount, priority) values
  (uid, 'Colchón de imprevistos', 300, 10),
  (uid, 'Fondo de mudanza', 500, 20);

  insert into public.fixed_expenses (user_id, name, amount, due_day) values
  (uid, 'Pensión del hijo', 50, null),
  (uid, 'Electricidad',     50, null),
  (uid, 'Internet',         25, null),
  (uid, 'Agua',             10, null);
end $$;
