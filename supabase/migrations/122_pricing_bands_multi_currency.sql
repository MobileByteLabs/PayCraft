-- 122_pricing_bands_multi_currency.sql
--
-- Every product gets a price in every MAJOR currency, not just the base one.
--
-- WHY 120 WAS NOT ENOUGH
-- Migration 120 seeded a row for each provider-served locale at the base amount in USD. That
-- satisfied the drift detector but not reality: Razorpay rejected the push outright —
-- "Razorpay does not accept USD for this account. Add an INR price for this product." A row in the
-- wrong currency is not a price; a provider that only settles INR cannot charge USD.
--
-- WHERE THE NUMBERS COME FROM
-- `dashboard/lib/pricing-template-data.ts#DEFAULT_BANDS` already declares country -> currency,
-- multiplier (relative to the USD reference) and a rounding granularity, for 32 countries. Those
-- multipliers are authored, not invented here. They were data only: the sole consumer was a UI that
-- renders an already-resolved template, and no template row existed (account_pricing_template was
-- empty), so the defaults reached nothing. This mirrors them into SQL so the seed path can apply
-- them without a human opening the pricing matrix per product.
--
-- ROUNDING — the one judgement call, and it is deliberately the boring one
-- `roundTo` is applied as CHARM rounding: round the converted amount UP to the next value whose
-- minor-unit remainder equals roundTo (…99, …990) or to the next multiple of roundTo for
-- zero-decimal currencies (JPY 100, KRW 1000). Rounding UP rather than nearest means a converted
-- price is never silently cheaper than the band intends. Every row is written source='fallback', so
-- an operator can find and replace all of them; none of these amounts is presented as chosen.

CREATE TABLE IF NOT EXISTS public.pricing_bands (
  country     text PRIMARY KEY,
  currency    text    NOT NULL,
  multiplier  numeric NOT NULL CHECK (multiplier > 0),
  round_to    integer NOT NULL CHECK (round_to > 0),
  zero_decimal boolean NOT NULL DEFAULT false
);

COMMENT ON TABLE public.pricing_bands IS
  'Country -> currency + multiplier + rounding, mirrored from DEFAULT_BANDS in '
  'dashboard/lib/pricing-template-data.ts. Edit BOTH or they drift.';

INSERT INTO public.pricing_bands (country, currency, multiplier, round_to, zero_decimal) VALUES
  ('US','USD',1.00,99,false),   ('GB','GBP',0.80,99,false),
  ('DE','EUR',0.92,99,false),   ('FR','EUR',0.92,99,false),
  ('ES','EUR',0.92,99,false),   ('IT','EUR',0.92,99,false),
  ('AU','AUD',0.90,99,false),   ('CA','CAD',0.90,99,false),
  ('JP','JPY',110.0,100,true),  ('KR','KRW',1300.0,1000,true),
  ('CN','CNY',7.20,99,false),   ('TW','TWD',15.0,99,false),
  ('IN','INR',30.0,99,false),   ('PK','PKR',100.0,99,false),
  ('BD','BDT',30.0,99,false),   ('BR','BRL',3.20,99,false),
  ('MX','MXN',17.0,99,false),   ('AR','ARS',350.0,100,false),
  ('CL','CLP',750.0,990,true),  ('CO','COP',3000.0,990,true),
  ('ZA','ZAR',5.50,99,false),   ('NG','NGN',700.0,99,false),
  ('EG','EGP',25.0,99,false),   ('ID','IDR',9000.0,99,true),
  ('PH','PHP',28.0,99,false),   ('VN','VND',14000.0,990,true),
  ('TH','THB',18.0,99,false),   ('TR','TRY',14.0,99,false),
  ('RU','RUB',50.0,99,false),   ('PL','PLN',2.20,99,false),
  ('SA','SAR',1.80,99,false),   ('AE','AED',1.80,99,false)
ON CONFLICT (country) DO UPDATE
  SET currency = EXCLUDED.currency,
      multiplier = EXCLUDED.multiplier,
      round_to = EXCLUDED.round_to,
      zero_decimal = EXCLUDED.zero_decimal;

-- Charm-round a converted minor-unit amount UP per the band.
CREATE OR REPLACE FUNCTION public.pricing_charm_round(p_minor numeric, p_round_to integer, p_zero_decimal boolean)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    -- Zero-decimal: the INPUT is USD minor units (cents) but the TARGET has no sub-unit, so ¥1 is
    -- one minor unit. Convert to major units BEFORE rounding, or the amount comes out 100x — the
    -- first version of this produced ¥461,900 for a $41.99 product instead of ¥4,619.
    WHEN p_zero_decimal THEN (ceil((p_minor / 100.0) / p_round_to) * p_round_to)::integer
    -- Two-decimal: land on the next whole major unit whose minor remainder is round_to (…99).
    ELSE ((ceil((p_minor - p_round_to) / 100.0) * 100) + p_round_to)::integer
  END;
$$;

COMMENT ON FUNCTION public.pricing_charm_round(numeric, integer, boolean) IS
  'Round a converted minor-unit amount UP to the band ending (…99 / …990) or, for zero-decimal '
  'currencies, up to the next multiple of the granularity. Never rounds a price DOWN.';
