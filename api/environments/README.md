# Environments

`production.bru` declares every credential under `vars:secret`, so Bruno reads them from the
process environment and **never writes a value into this directory**. That is why the collection is
committable.

Export before running:

```bash
FW=../../../../..
export BRUNO_VAR_anon_key="$(bash $FW/core/scripts/secrets-get.sh paycraft-supabase-anon-key --allow-claude-stdout)"
export BRUNO_VAR_paycraft_pk_live="$(bash $FW/core/scripts/secrets-get.sh cappy-paycraft-pk-live --allow-claude-stdout)"
export BRUNO_VAR_paycraft_pk_test="$(bash $FW/core/scripts/secrets-get.sh cappy-paycraft-pk-test --allow-claude-stdout)"
```

`admin_email` / `admin_password` are only needed by `admin/` requests, which act as a real
authenticated tenant admin. Everything under `edge/` is anonymous and needs none of them.
