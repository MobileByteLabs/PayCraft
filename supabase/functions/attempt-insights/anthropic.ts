// supabase/functions/attempt-insights/anthropic.ts
//
// The model client for attempt-insights: the official Anthropic SDK, one Messages call per tenant-week.
//
//   · structured outputs (output_config.format = INSIGHT_SCHEMA), so the answer is the JSON engine.parseInsight
//     reads, never free prose;
//   · effort low with adaptive thinking (the default on the selectable models) — a weekly note over a dozen
//     numbers needs no deep reasoning, and MAX_TOKENS bounds thinking + answer together;
//   · server-side fallback ("default"), so a policy refusal is retried on the model's default fallback inside the
//     same call; engine.costUsd prices each hop from usage.iterations and the budget reservation covers it.
// A refusal comes back as stop_reason "refusal" (no content); engine records it billed and delivers nothing.

import Anthropic from "npm:@anthropic-ai/sdk@1.7.0"
import type { LlmClient, LlmIteration, LlmRequest, LlmResult } from "./engine.ts"

const FALLBACK_BETA = "server-side-fallback-2026-07-01"

export function anthropicClient(apiKey: string): LlmClient {
  const client = new Anthropic({ apiKey, maxRetries: 2, timeout: 90_000 })
  return {
    async complete(req: LlmRequest): Promise<LlmResult> {
      const msg = await client.beta.messages.create({
        model: req.model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: [{ role: "user", content: req.prompt }],
        output_config: { effort: "low", format: { type: "json_schema", schema: req.schema } },
        betas: [FALLBACK_BETA],
        fallbacks: "default",
      })
      const text = msg.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("")
      const iterations: LlmIteration[] | null = msg.usage.iterations?.length
        ? msg.usage.iterations.map((it) => ({
          type: it.type,
          model: "model" in it ? String(it.model) : undefined,
          input_tokens: it.input_tokens ?? 0,
          output_tokens: it.output_tokens ?? 0,
          cache_creation_input_tokens: it.cache_creation_input_tokens ?? 0,
          cache_read_input_tokens: it.cache_read_input_tokens ?? 0,
        }))
        : null
      return {
        model: msg.model,
        stopReason: msg.stop_reason ?? null,
        text,
        usage: {
          input_tokens: msg.usage.input_tokens,
          output_tokens: msg.usage.output_tokens,
          cache_creation_input_tokens: msg.usage.cache_creation_input_tokens ?? 0,
          cache_read_input_tokens: msg.usage.cache_read_input_tokens ?? 0,
        },
        iterations,
      }
    },
  }
}
