package com.iapp.ekyc.internal

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.content.IntentCompat
import com.iapp.ekyc.EkycErrorCode
import com.iapp.ekyc.IappEkycError
import com.iapp.ekyc.IappEkycRequest
import org.json.JSONObject

/**
 * Full-screen WebView shell running one eKYC flow via the hosted bridge page
 * (docs/WEBVIEW_BRIDGE.md). Internal — launch through `IappEkycContract` or
 * `IappEkyc.start`. Destroying the WebView (back button / finish) is the
 * abort mechanism: it stops the camera and the in-page flow.
 */
internal class IappEkycActivity : ComponentActivity() {
    companion object {
        private const val EXTRA_REQUEST = "com.iapp.ekyc.REQUEST"

        fun newIntent(context: Context, request: IappEkycRequest): Intent =
            Intent(context, IappEkycActivity::class.java).putExtra(EXTRA_REQUEST, request)
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private var webView: WebView? = null
    private var request: IappEkycRequest? = null
    private var finished = false

    private val cameraPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted) {
                loadHostPage()
            } else {
                finishWithError(
                    IappEkycError(
                        code = EkycErrorCode.CAMERA_PERMISSION_DENIED,
                        statusCode = null,
                        messageKey = "error_camera_permission",
                        message = "Camera permission denied",
                    ))
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val request =
            intent?.let {
                IntentCompat.getParcelableExtra(it, EXTRA_REQUEST, IappEkycRequest::class.java)
            }
        if (request == null) {
            finishWithError(invalidConfig("Missing IappEkycRequest extra"))
            return
        }
        this.request = request

        if (Uri.parse(request.config.hostPageUrl).scheme != "https") {
            finishWithError(
                invalidConfig("hostPageUrl must be HTTPS (camera requires a secure context)"))
            return
        }

        // Resolve the runtime permission BEFORE loading the page so a denial
        // fails fast and onPermissionRequest can grant silently.
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) ==
            PackageManager.PERMISSION_GRANTED) {
            loadHostPage()
        } else {
            cameraPermission.launch(Manifest.permission.CAMERA)
        }
    }

    override fun onDestroy() {
        webView?.apply {
            removeJavascriptInterface("IappEkycAndroid")
            stopLoading()
            destroy()
        }
        webView = null
        super.onDestroy()
    }

    // MARK: WebView

    private fun loadHostPage() {
        val request = request ?: return
        val hostPageHost = Uri.parse(request.config.hostPageUrl).host

        val webView = WebView(this)
        @Suppress("SetJavaScriptEnabled")
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.settings.mediaPlaybackRequiresUserGesture = false
        webView.setBackgroundColor(android.graphics.Color.BLACK)

        webView.addJavascriptInterface(
            EkycBridge { json -> mainHandler.post { onBridgeMessage(json) } }, "IappEkycAndroid")

        webView.webChromeClient =
            object : WebChromeClient() {
                override fun onPermissionRequest(permission: PermissionRequest) {
                    mainHandler.post {
                        val fromHostPage = permission.origin?.host == hostPageHost
                        val wantsCamera =
                            permission.resources.contains(
                                PermissionRequest.RESOURCE_VIDEO_CAPTURE)
                        if (fromHostPage && wantsCamera) {
                            permission.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))
                        } else {
                            permission.deny()
                        }
                    }
                }
            }

        webView.webViewClient =
            object : WebViewClient() {
                override fun onReceivedError(
                    view: WebView,
                    req: WebResourceRequest,
                    error: WebResourceError,
                ) {
                    if (req.isForMainFrame) {
                        finishWithError(
                            IappEkycError(
                                code = EkycErrorCode.HOST_PAGE_LOAD_FAILED,
                                statusCode = null,
                                messageKey = "error_network",
                                message =
                                    "Could not load ${request.config.hostPageUrl}: ${error.description}",
                            ))
                    }
                }
            }

        setContentView(webView)
        this.webView = webView
        webView.loadUrl(request.config.hostPageUrl)
    }

    // MARK: Bridge events (main thread)

    private fun onBridgeMessage(json: String) {
        if (finished) return
        val request = request ?: return
        when (val event = BridgeMessage.parse(json) ?: return) {
            is BridgeMessage.Event.Ready -> {
                if (event.hostPageVersion != EkycVersion.SUPPORTED_HOST_PAGE_VERSION) {
                    finishWithError(
                        IappEkycError(
                            code = EkycErrorCode.PROTOCOL_MISMATCH,
                            statusCode = null,
                            messageKey = "error_generic",
                            message =
                                "Host page version ${event.hostPageVersion} is not supported — update the iApp eKYC SDK",
                        ))
                } else {
                    webView?.evaluateJavascript(BridgeMessage.startScript(request), null)
                }
            }
            is BridgeMessage.Event.State -> {
                // Informational only; the Android API is result-driven.
            }
            is BridgeMessage.Event.Result -> deliverResult(event.flow, event.result)
            is BridgeMessage.Event.Error -> finishWithError(event.error)
            BridgeMessage.Event.Cancelled -> finishCancelled()
        }
    }

    private fun deliverResult(flow: String, result: JSONObject) {
        fun imagePath(key: String): String? =
            ResultFiles.writeImage(this, result.optJSONObject(key)?.optString("base64"))

        val wire =
            when (flow) {
                "documentCapture" ->
                    EkycWireResult(
                        kind = "document",
                        documentType = result.optString("documentType"),
                        rawJson = result.optJSONObject("raw")?.toString() ?: "{}",
                        imagePath = imagePath("capturedImage"),
                    )
                "activeLiveness" ->
                    EkycWireResult(
                        kind = "liveness",
                        rawJson = result.optJSONObject("raw")?.toString() ?: "{}",
                        verdictJson = result.optJSONObject("verdict")?.toString() ?: "{}",
                        passed = result.optBoolean("passed", false),
                        signature = result.optString("signature"),
                        signatureAlg = result.optString("signatureAlg"),
                        imagePath = imagePath("selfieImage"),
                    )
                "faceCapture" ->
                    EkycWireResult(kind = "face", imagePath = imagePath("image"))
                else -> null
            }
        if (wire == null) {
            finishWithError(invalidConfig("Malformed result payload for flow '$flow'"))
            return
        }
        finishWith { putExtra(ResultFiles.EXTRA_RESULT, wire) }
    }

    // MARK: Outcomes

    private fun invalidConfig(message: String) =
        IappEkycError(
            code = EkycErrorCode.INVALID_CONFIG,
            statusCode = null,
            messageKey = "error_generic",
            message = message,
        )

    private fun finishWithError(error: IappEkycError) {
        finishWith { putExtra(ResultFiles.EXTRA_RESULT, EkycWireResult(kind = "failed", error = error)) }
    }

    private fun finishCancelled() {
        if (finished) return
        finished = true
        setResult(RESULT_CANCELED)
        finish()
    }

    private fun finishWith(build: Intent.() -> Unit) {
        if (finished) return
        finished = true
        setResult(RESULT_OK, Intent().apply(build))
        finish()
    }
}
