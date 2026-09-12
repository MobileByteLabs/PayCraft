# Security regression (091) — anon-rpc-write

An anonymous PostgREST caller must not be able to write another tenant's product. This succeeded before migration 091.

Run: `bash run.sh`
