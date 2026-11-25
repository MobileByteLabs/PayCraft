-- Canary fixture (green): 212's real dispatcher — 211's weekly job now reaches the attempt-insights function,
-- and no second insights schedule exists.
CREATE TABLE IF NOT EXISTS public.attempt_insights (id uuid PRIMARY KEY);
CREATE OR REPLACE FUNCTION public.attempt_insights_dispatch()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM paycraft_function_post('attempt-insights');
END; $$;
