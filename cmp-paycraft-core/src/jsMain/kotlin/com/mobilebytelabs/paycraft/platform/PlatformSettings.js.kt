package com.mobilebytelabs.paycraft.platform

import com.russhwolf.settings.Settings
import com.russhwolf.settings.StorageSettings
import org.w3c.dom.Storage

/** Browser: `localStorage` (the no-arg `Settings()`). Node.js has no `localStorage`: an in-memory Storage. */
internal actual fun platformSettings(): Settings =
    if (js("typeof localStorage !== 'undefined'") as Boolean) Settings() else StorageSettings(inMemoryStorage())

/** A process-lifetime object with the Web Storage API (getItem/setItem/removeItem/clear/key/length). */
private fun inMemoryStorage(): Storage = js(
    """
    (function () {
        var m = new Map();
        var s = {
            getItem: function (k) { return m.has(k) ? m.get(k) : null; },
            setItem: function (k, v) { m.set(k, String(v)); },
            removeItem: function (k) { m.delete(k); },
            clear: function () { m.clear(); },
            key: function (i) { var ks = Array.from(m.keys()); return i < ks.length ? ks[i] : null; }
        };
        Object.defineProperty(s, 'length', { get: function () { return m.size; } });
        return s;
    })()
    """,
).unsafeCast<Storage>()
