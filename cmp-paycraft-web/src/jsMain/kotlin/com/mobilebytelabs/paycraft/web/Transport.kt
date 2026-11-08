package com.mobilebytelabs.paycraft.web

import kotlinx.coroutines.await
import kotlin.js.Promise

/** The one network seam. Production uses [FetchTransport]; tests inject a fake. */
internal interface Transport {
    suspend fun send(method: String, url: String, headers: Map<String, String>, body: String?): HttpResult
}

internal class HttpResult(val status: Int, val body: String) {
    val ok: Boolean get() = status in 200..299
}

/**
 * The platform's own `fetch` (every browser, Node 18+, Cloudflare/Deno workers) — no HTTP client
 * library, which keeps the website bundle small. Resolved from the global scope at call time so the
 * module can be imported during a static-site build without a `window`.
 */
internal class FetchTransport : Transport {
    override suspend fun send(method: String, url: String, headers: Map<String, String>, body: String?): HttpResult {
        val init: dynamic = js("({})")
        init.method = method
        val h: dynamic = js("({})")
        for ((k, v) in headers) h[k] = v
        init.headers = h
        if (body != null) init.body = body
        val fetchFn: dynamic = js("globalThis.fetch")
        val response: dynamic = (fetchFn(url, init) as Promise<dynamic>).await()
        val text = (response.text() as Promise<String>).await()
        return HttpResult((response.status as Number).toInt(), text)
    }
}
