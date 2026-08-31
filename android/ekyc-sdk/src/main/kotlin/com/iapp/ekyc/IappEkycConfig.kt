package com.iapp.ekyc

import android.os.Parcelable
import com.iapp.ekyc.internal.EkycVersion
import kotlinx.parcelize.Parcelize

/**
 * Common configuration for all flows (docs/WEBVIEW_BRIDGE.md config schema).
 * Build with [Builder] (Java) or [iappEkycConfig]-style Kotlin usage:
 *
 * ```kotlin
 * val config = IappEkycConfig.Builder("YOUR_API_KEY").locale(EkycLocale.TH).build()
 * ```
 */
@Parcelize
class IappEkycConfig private constructor(
    /** iApp API key. `""` = proxy mode: set [baseUrl] to your backend (docs/SECURITY.md). */
    val apiKey: String,
    /** Override the API origin (proxy mode). Default: https://api.iapp.co.th */
    val baseUrl: String?,
    /** Per-request timeout in milliseconds (engine default: 60000). */
    val timeoutMs: Long?,
    /** UI language. Default: English. */
    val locale: EkycLocale,
    /** Theme token overrides. */
    val theme: IappEkycTheme?,
    /** Include captured/selfie JPEGs in results. Default: true. */
    val returnSelfieImage: Boolean,
    /** Hosted bridge page; HTTPS only (camera requires a secure context). */
    val hostPageUrl: String,
) : Parcelable {

    class Builder(private val apiKey: String) {
        private var baseUrl: String? = null
        private var timeoutMs: Long? = null
        private var locale: EkycLocale = EkycLocale.EN
        private var theme: IappEkycTheme? = null
        private var returnSelfieImage: Boolean = true
        private var hostPageUrl: String = EkycVersion.DEFAULT_HOST_PAGE_URL

        fun baseUrl(value: String) = apply { baseUrl = value }

        fun timeoutMs(value: Long) = apply { timeoutMs = value }

        fun locale(value: EkycLocale) = apply { locale = value }

        fun theme(value: IappEkycTheme) = apply { theme = value }

        fun returnSelfieImage(value: Boolean) = apply { returnSelfieImage = value }

        fun hostPageUrl(value: String) = apply { hostPageUrl = value }

        fun build(): IappEkycConfig {
            // The README snippets use this literal; passing it through means the
            // developer pasted the sample without a key. Every flow would run to
            // the end and then fail with INVALID_API_KEY -- say so up front.
            require(apiKey != PLACEHOLDER_API_KEY) { MISSING_API_KEY_MESSAGE }
            return IappEkycConfig(
                apiKey, baseUrl, timeoutMs, locale, theme, returnSelfieImage, hostPageUrl,
            )
        }
    }

    companion object {
        const val PLACEHOLDER_API_KEY = "YOUR_API_KEY"
        const val MISSING_API_KEY_MESSAGE =
            "IappEkycConfig: replace \"YOUR_API_KEY\" with your iApp API key. " +
                "Sign in at https://iapp.co.th and create one under Control Panel > API Keys " +
                "(https://iapp.co.th/control/api-keys); new accounts include free credits. " +
                "Then pass it: IappEkycConfig.Builder(\"iapp_live_...\")"
    }
}

/** Which flow to run, plus its flow-specific options. */
sealed class IappEkycRequest : Parcelable {
    abstract val config: IappEkycConfig

    internal abstract val flowWireName: String

    /** Document auto-capture + OCR upload. */
    @Parcelize
    class DocumentCapture
    @JvmOverloads
    constructor(
        override val config: IappEkycConfig,
        val documentType: EkycDocumentType,
        val cameraFacing: EkycCameraFacing = EkycCameraFacing.BACK,
    ) : IappEkycRequest() {
        override val flowWireName: String
            get() = "documentCapture"
    }

    /** Face Active Liveness challenges + server-signed verdict. */
    @Parcelize
    class ActiveLiveness(override val config: IappEkycConfig) : IappEkycRequest() {
        override val flowWireName: String
            get() = "activeLiveness"
    }

    /** Frontal selfie auto-capture (no liveness challenges, no API call). */
    @Parcelize
    class FaceCapture(override val config: IappEkycConfig) : IappEkycRequest() {
        override val flowWireName: String
            get() = "faceCapture"
    }
}
