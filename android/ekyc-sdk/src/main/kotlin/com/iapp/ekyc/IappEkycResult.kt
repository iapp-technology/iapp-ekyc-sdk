package com.iapp.ekyc

import android.os.Parcelable
import kotlinx.parcelize.Parcelize

/** Flow error (docs/WEBVIEW_BRIDGE.md error codes + engine i18n key). */
@Parcelize
class IappEkycError(
    val code: EkycErrorCode,
    /** HTTP status code when the error came from the API, else null. */
    val statusCode: Int?,
    /** Engine i18n key (resolvable through the engine message tables). */
    val messageKey: String,
    override val message: String,
    /** Retry-After seconds for [EkycErrorCode.RATE_LIMITED]. */
    val retryAfterSeconds: Int? = null,
    /** Fail reason for [EkycErrorCode.LIVENESS_FAILED] (timeout / ...). */
    val reason: String? = null,
) : Exception(message), Parcelable

/**
 * Outcome of a flow. Exactly one subclass per launch: a success variant,
 * [Failed], or [Cancelled].
 */
sealed class IappEkycResult {
    /** Document captured + OCR completed. */
    class DocumentCaptured(
        /** Wire document type, e.g. `"thaiIdFront"`. */
        val documentType: String,
        /** Full OCR response JSON, untouched. */
        val rawJson: String,
        /** Perspective-corrected JPEG (null when `returnSelfieImage=false`). */
        val capturedImage: ByteArray?,
    ) : IappEkycResult()

    /**
     * Active liveness finalized. Only the server-signed [verdictJson]
     * (verify [signature] on YOUR backend) proves liveness — never trust
     * [passed] alone on-device (docs/SECURITY.md).
     */
    class LivenessPassed(
        /** Full finalize response JSON, untouched. */
        val rawJson: String,
        /** The signed verdict object (session_id, selfie_sha256, nonce, ...). */
        val verdictJson: String,
        val passed: Boolean,
        /** hex(HMAC-SHA256(secret, canonicalJSON(verdict))) */
        val signature: String,
        val signatureAlg: String,
        /** The uploaded selfie JPEG (null when `returnSelfieImage=false`). */
        val selfieImage: ByteArray?,
    ) : IappEkycResult()

    /** Frontal selfie captured (no liveness, no API call). */
    class FaceCaptured(val image: ByteArray) : IappEkycResult()

    /** The flow failed — see [error]. */
    class Failed(val error: IappEkycError) : IappEkycResult()

    /** The user cancelled (in-flow Cancel button or system back). */
    object Cancelled : IappEkycResult()
}

/** Simple callback alternative to [IappEkycContract] (see [IappEkyc.start]). */
interface IappEkycCallback {
    /** [IappEkycResult.DocumentCaptured] / [IappEkycResult.LivenessPassed] / [IappEkycResult.FaceCaptured]. */
    fun onResult(result: IappEkycResult)

    fun onError(error: IappEkycError)

    fun onCancelled()
}
