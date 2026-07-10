package com.iapp.ekyc.internal

import com.iapp.ekyc.EkycErrorCode
import com.iapp.ekyc.IappEkycError
import com.iapp.ekyc.IappEkycRequest
import org.json.JSONObject

/**
 * Bridge protocol v1 codec (docs/WEBVIEW_BRIDGE.md). Pure org.json — no
 * android.* imports — so it is unit-testable on the JVM.
 */
internal object BridgeMessage {

    sealed class Event {
        class Ready(val hostPageVersion: Int) : Event()

        class State(val state: String, val messageKey: String) : Event()

        class Result(val flow: String, val result: JSONObject) : Event()

        class Error(val error: IappEkycError) : Event()

        object Cancelled : Event()
    }

    /** Parse a host-page event JSON string; null for foreign/invalid messages. */
    fun parse(json: String): Event? {
        val dict =
            try {
                JSONObject(json)
            } catch (_: Exception) {
                return null
            }
        return when (dict.optString("type")) {
            "ready" -> Event.Ready(dict.optInt("hostPageVersion", -1))
            "state" -> Event.State(dict.optString("state"), dict.optString("messageKey"))
            "result" -> {
                val result = dict.optJSONObject("result") ?: return null
                Event.Result(dict.optString("flow"), result)
            }
            "error" -> {
                val error = dict.optJSONObject("error") ?: JSONObject()
                Event.Error(
                    IappEkycError(
                        code = EkycErrorCode.fromBridge(error.optString("code", "UNKNOWN")),
                        statusCode =
                            if (error.isNull("statusCode")) null else error.optInt("statusCode"),
                        messageKey = error.optString("messageKey", "error_generic"),
                        message = error.optString("message", "Unknown error"),
                        retryAfterSeconds =
                            if (error.isNull("retryAfterSeconds")) null
                            else error.optInt("retryAfterSeconds"),
                        reason = if (error.isNull("reason")) null else error.optString("reason"),
                    ))
            }
            "cancelled" -> Event.Cancelled
            else -> null
        }
    }

    /**
     * Bridge config JSON for `IappEkycHost.start(...)`. The API key travels
     * only here — never in the page URL.
     */
    fun configJson(request: IappEkycRequest): String {
        val config = request.config
        val json = JSONObject()
        json.put("protocolVersion", EkycVersion.PROTOCOL_VERSION)
        json.put("flow", request.flowWireName)
        json.put("apiKey", config.apiKey)
        json.put("locale", config.locale.wireName)
        json.put("returnSelfieImage", config.returnSelfieImage)
        json.put(
            "integration",
            JSONObject()
                .put("name", "iapp-ekyc-sdk-android")
                .put("platform", "android")
                .put(
                    "version",
                    "${EkycVersion.WRAPPER_VERSION}+engine.${EkycVersion.ENGINE_VERSION}"))
        if (request is IappEkycRequest.DocumentCapture) {
            json.put("documentType", request.documentType.wireName)
            json.put("cameraFacing", request.cameraFacing.wireName)
        }
        config.baseUrl?.let { json.put("baseUrl", it) }
        config.timeoutMs?.let { json.put("timeoutMs", it) }
        config.theme?.asPairs()?.takeIf { it.isNotEmpty() }?.let { pairs ->
            val theme = JSONObject()
            pairs.forEach { (key, value) -> theme.put(key, value) }
            json.put("theme", theme)
        }
        return json.toString()
    }

    /** JS call injecting the config, with the JSON as an escaped string literal. */
    fun startScript(request: IappEkycRequest): String =
        "window.IappEkycHost.start(${JSONObject.quote(configJson(request))}); true;"
}
