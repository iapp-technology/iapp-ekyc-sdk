package com.iapp.ekyc.internal

import com.iapp.ekyc.EkycCameraFacing
import com.iapp.ekyc.EkycDocumentType
import com.iapp.ekyc.EkycErrorCode
import com.iapp.ekyc.EkycLocale
import com.iapp.ekyc.IappEkycConfig
import com.iapp.ekyc.IappEkycRequest
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BridgeMessageTest {
    // MARK: Event parsing (host → native)

    @Test
    fun parsesReady() {
        val event =
            BridgeMessage.parse(
                """{"protocolVersion":1,"type":"ready","hostPageVersion":1,"engineVersion":"0.2.0","secureContext":true}""")
        assertTrue(event is BridgeMessage.Event.Ready)
        assertEquals(1, (event as BridgeMessage.Event.Ready).hostPageVersion)
    }

    @Test
    fun parsesResultEnvelope() {
        val event =
            BridgeMessage.parse(
                """{"type":"result","flow":"activeLiveness","result":{"passed":true,"signature":"abc"}}""")
        assertTrue(event is BridgeMessage.Event.Result)
        val result = event as BridgeMessage.Event.Result
        assertEquals("activeLiveness", result.flow)
        assertTrue(result.result.optBoolean("passed"))
    }

    @Test
    fun parsesErrorWithRetryAfterAndUnknownCodes() {
        val event =
            BridgeMessage.parse(
                """{"type":"error","error":{"code":"RATE_LIMITED","statusCode":429,"messageKey":"error_rate_limited","message":"slow down","retryAfterSeconds":30}}""")
        val error = (event as BridgeMessage.Event.Error).error
        assertEquals(EkycErrorCode.RATE_LIMITED, error.code)
        assertEquals(429, error.statusCode)
        assertEquals(30, error.retryAfterSeconds)

        val unknown =
            BridgeMessage.parse(
                """{"type":"error","error":{"code":"SOMETHING_NEW","message":"x"}}""")
        assertEquals(
            EkycErrorCode.UNKNOWN, (unknown as BridgeMessage.Event.Error).error.code)
    }

    @Test
    fun parsesCancelledAndRejectsForeignMessages() {
        assertTrue(BridgeMessage.parse("""{"type":"cancelled"}""") is BridgeMessage.Event.Cancelled)
        assertNull(BridgeMessage.parse("""{"type":"telemetry"}"""))
        assertNull(BridgeMessage.parse("not json"))
    }

    // MARK: Config encoding (native → host)

    @Test
    fun configJsonCarriesIdentityAndDocumentFields() {
        val config = IappEkycConfig.Builder("sk-test").locale(EkycLocale.TH).build()
        val request =
            IappEkycRequest.DocumentCapture(
                config, EkycDocumentType.PASSPORT, EkycCameraFacing.FRONT)
        val json = JSONObject(BridgeMessage.configJson(request))

        assertEquals(1, json.getInt("protocolVersion"))
        assertEquals("documentCapture", json.getString("flow"))
        assertEquals("passport", json.getString("documentType"))
        assertEquals("user", json.getString("cameraFacing"))
        assertEquals("th", json.getString("locale"))
        assertEquals("sk-test", json.getString("apiKey"))
        val integration = json.getJSONObject("integration")
        assertEquals("iapp-ekyc-sdk-android", integration.getString("name"))
        assertEquals("android", integration.getString("platform"))
    }

    @Test
    fun livenessConfigOmitsDocumentFields() {
        val request =
            IappEkycRequest.ActiveLiveness(IappEkycConfig.Builder("").build())
        val json = JSONObject(BridgeMessage.configJson(request))
        assertFalse(json.has("documentType"))
        assertFalse(json.has("cameraFacing"))
        assertEquals("", json.getString("apiKey"))
    }

    @Test
    fun startScriptEscapesHostileStrings() {
        val config = IappEkycConfig.Builder("k\"1'\n</script>").build()
        val script = BridgeMessage.startScript(IappEkycRequest.FaceCapture(config))
        assertTrue(script.startsWith("window.IappEkycHost.start(\""))
        assertTrue(script.endsWith("); true;"))
        assertFalse(script.contains("k\"1"))
    }
}
