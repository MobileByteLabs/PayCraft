-- Migration 007: Daily OTP send gate
-- Tracks OTP sends per day. App checks before showing OTP button.
-- If count >= 300 (Brevo free limit), app shows manual support option instead.

CREATE TABLE IF NOT EXISTS otp_send_log (
    log_date   DATE PRIMARY KEY DEFAULT CURRENT_DATE,
    send_count INT  NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE otp_send_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_read_otp_log"
    ON otp_send_log FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "service_write_otp_log"
    ON otp_send_log FOR ALL TO service_role USING (true);

-- ─── check_otp_gate ──────────────────────────────────────────────────────────
-- Returns whether the daily OTP send budget is still available.
CREATE OR REPLACE FUNCTION check_otp_gate(p_daily_limit INT DEFAULT 300)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE v_count INT := 0;
BEGIN
    SELECT send_count INTO v_count FROM otp_send_log WHERE log_date = CURRENT_DATE;
    v_count := COALESCE(v_count, 0);
    RETURN jsonb_build_object(
        'available',   v_count < p_daily_limit,
        'sends_today', v_count,
        'limit',       p_daily_limit
    );
END;
$$;

GRANT EXECUTE ON FUNCTION check_otp_gate(INT) TO anon, authenticated;

-- ─── record_otp_send ─────────────────────────────────────────────────────────
-- Called by the otp-send-hook Edge Function each time an OTP email is sent.
CREATE OR REPLACE FUNCTION record_otp_send()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    INSERT INTO otp_send_log (log_date, send_count, updated_at)
    VALUES (CURRENT_DATE, 1, now())
    ON CONFLICT (log_date)
    DO UPDATE SET send_count = otp_send_log.send_count + 1, updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION record_otp_send() TO service_role;
