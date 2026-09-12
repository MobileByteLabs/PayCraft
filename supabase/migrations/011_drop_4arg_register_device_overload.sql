-- Migration 011: Drop 4-arg register_device overload (PGRST203 fix)
--
-- Bug: Two overloads of register_device exist:
--   (1) 4-arg: register_device(p_email, p_platform, p_device_name, p_mode)   ← legacy, migration 008
--   (2) 5-arg: register_device(p_email, p_platform, p_device_name, p_device_id DEFAULT NULL, p_mode DEFAULT 'live')
--
-- PostgREST PGRST203 fires when the client sends p_device_id=null in the JSON body:
-- PostgREST cannot distinguish between "param not provided" and "param is null",
-- so both overloads appear as valid candidates → ambiguity error.
--
-- Fix: drop the 4-arg overload. The 5-arg version handles legacy clients via
-- DEFAULT NULL on p_device_id — no backward compat is lost.

DROP FUNCTION IF EXISTS register_device(TEXT, TEXT, TEXT, TEXT);
