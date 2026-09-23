---
id: HOME
title: PayCraft
slug: /
sidebar_label: Home
hide_table_of_contents: true
description: Multi-provider subscription billing for KMP apps — Stripe, Razorpay, Cashfree, Google Play and the App Store behind one SDK, one dashboard and one API.
---

<div className="pc-hero">

# Craft your own billing

Subscriptions across **Stripe, Razorpay, Cashfree, Google Play and the App Store** — behind one
Kotlin Multiplatform SDK, one dashboard, and one API. Self-hosted, so the money and the data stay
yours.

```kotlin
PayCraft.initialize(apiKey = "pk_live_…")
```

<div className="pc-hero-actions">
  <a className="pc-btn pc-btn-primary" href="/QUICK_START/">Quick start</a>
  <a className="pc-btn" href="/API_OVERVIEW/">Management API</a>
  <a className="pc-btn" href="/MCP_SERVER/">MCP server</a>
</div>

</div>

## Start here

<div className="pc-grid">

<div className="pc-card">

### [Quick start →](/QUICK_START/)

Add billing to a KMP app. One `initialize` call; products, providers, pricing and paywall come from
the dashboard.

</div>

<div className="pc-card">

### [5-minute onboarding →](/ONBOARDING_5MIN/)

Create a tenant, connect a provider, publish a paywall — end to end.

</div>

<div className="pc-card">

### [Providers →](/PROVIDERS/)

What each provider supports, how test mode works, and what only a person can do.

</div>

</div>

## Automate it

The dashboard is for people. These are for pipelines and assistants.

<div className="pc-grid">

<div className="pc-card pc-card-accent">

### [Management API →](/API_OVERVIEW/)

Fifteen operations over `api.paycraft.mobilebytesensei.com/v1`. Check provider readiness in CI, sync
your catalogue, read subscribers and the audit trail — no browser session required.

<span className="pc-tag">REST · OpenAPI 3.1</span>

</div>

<div className="pc-card pc-card-accent">

### [MCP server →](/MCP_SERVER/)

The same API as tools for an AI assistant. Fifteen tools, scoped by the key you hand it, with writes
still gated behind a confirmation.

<span className="pc-tag">Claude Code · Claude Desktop</span>

</div>

</div>

## The thing worth knowing early

**Google Play and App Store test mode cannot be turned on by any API.** Neither store exposes one.
PayCraft reports those providers as ready only when a real sandbox purchase arrives, and hands you
the exact steps to get there — in the dashboard, in the API response, and to your assistant.

Everything else reaches test mode with a test credential and a product sync.

## Operate it

<div className="pc-grid pc-grid-tight">

<div className="pc-card pc-card-sm">

**[Launch runbook →](/PRODUCTION_LAUNCH_RUNBOOK/)** Going live, in order.

</div>

<div className="pc-card pc-card-sm">

**[Recipes →](/API_RECIPES/)** Release gates, sync pipelines, support lookups.

</div>

<div className="pc-card pc-card-sm">

**[Security →](/SECURITY/)** Key handling, PCI scope, what we never store.

</div>

<div className="pc-card pc-card-sm">

**[DR runbook →](/DR_RUNBOOK/)** When a provider or the backend is down.

</div>

</div>
