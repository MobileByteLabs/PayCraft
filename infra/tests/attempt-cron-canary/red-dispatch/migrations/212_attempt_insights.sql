-- Canary fixture (red-dispatch): 212 lands its tables but leaves the dispatcher call commented out, so the weekly
-- job would keep calling a function that does nothing. The gate must name attempt_insights_dispatch.
CREATE TABLE IF NOT EXISTS public.attempt_insights (id uuid PRIMARY KEY);
CREATE OR REPLACE FUNCTION public.attempt_insights_dispatch()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- PERFORM paycraft_function_post('attempt-insights');
  RAISE NOTICE 'disabled';
END; $$;
