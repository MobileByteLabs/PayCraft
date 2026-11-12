  for (const e of body.events) {
    rows.push({
      name, step, platform,
      sku: str(e.sku, 100), reason: str(e.reason, 100),
      free_text: str(e.freeText, 500),
      occurred_at: new Date(at).toISOString(),
    })
  }
  const { error } = await supabase.from("paywall_events").insert(
    rows.map((r) => ({ ...r, tenant_id: tenantId, user_ref: userRef, device_ref: deviceRef, country, mode })),
  )
