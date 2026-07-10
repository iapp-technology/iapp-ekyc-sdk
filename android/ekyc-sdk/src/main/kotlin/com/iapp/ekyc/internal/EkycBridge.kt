package com.iapp.ekyc.internal

import android.webkit.JavascriptInterface

/**
 * Injected as `window.IappEkycAndroid` (docs/WEBVIEW_BRIDGE.md). Called on a
 * WebView-internal thread — the callback must hop to the main thread.
 */
internal class EkycBridge(private val onMessage: (String) -> Unit) {
    @JavascriptInterface
    fun postMessage(json: String) {
        onMessage(json)
    }
}
