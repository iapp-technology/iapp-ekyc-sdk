package com.iapp.ekyc.internal

import android.content.Context
import android.content.Intent
import android.os.Parcelable
import android.util.Base64
import androidx.core.content.IntentCompat
import com.iapp.ekyc.EkycErrorCode
import com.iapp.ekyc.IappEkycError
import com.iapp.ekyc.IappEkycResult
import java.io.File
import java.util.UUID
import kotlinx.parcelize.Parcelize

/**
 * Activity results ride Intents (~1 MB Binder cap), so image bytes are
 * handed off through cache files: the activity writes them, [parse] reads
 * and deletes them immediately (no images linger on device).
 */
@Parcelize
internal class EkycWireResult(
    /** "document" | "liveness" | "face" | "failed" */
    val kind: String,
    val documentType: String? = null,
    val rawJson: String? = null,
    val verdictJson: String? = null,
    val passed: Boolean = false,
    val signature: String? = null,
    val signatureAlg: String? = null,
    val imagePath: String? = null,
    val error: IappEkycError? = null,
) : Parcelable

internal object ResultFiles {
    const val EXTRA_RESULT = "com.iapp.ekyc.RESULT"

    private fun dir(context: Context) = File(context.cacheDir, "iapp_ekyc")

    /** Decode a bridge base64 image into a fresh cache file; null on failure. */
    fun writeImage(context: Context, base64: String?): String? {
        if (base64.isNullOrEmpty()) return null
        val bytes =
            try {
                Base64.decode(base64, Base64.DEFAULT)
            } catch (_: IllegalArgumentException) {
                return null
            }
        val dir = dir(context)
        if (!dir.isDirectory && !dir.mkdirs()) return null
        val file = File(dir, "${UUID.randomUUID()}.jpg")
        return try {
            file.writeBytes(bytes)
            file.absolutePath
        } catch (_: Exception) {
            null
        }
    }

    /** Sweep leftover handoff files (e.g. after process death mid-flow). */
    fun clear(context: Context) {
        dir(context).listFiles()?.forEach { it.delete() }
    }

    /** Read-and-delete the image handoff file. */
    private fun consumeImage(path: String?): ByteArray? {
        if (path == null) return null
        val file = File(path)
        return try {
            file.readBytes()
        } catch (_: Exception) {
            null
        } finally {
            file.delete()
        }
    }

    /** Map the activity result Intent back to the public result type. */
    fun parse(resultCode: Int, intent: Intent?): IappEkycResult {
        val wire =
            intent?.let {
                IntentCompat.getParcelableExtra(it, EXTRA_RESULT, EkycWireResult::class.java)
            }
        if (resultCode != android.app.Activity.RESULT_OK || wire == null) {
            return IappEkycResult.Cancelled
        }
        return when (wire.kind) {
            "document" ->
                IappEkycResult.DocumentCaptured(
                    documentType = wire.documentType.orEmpty(),
                    rawJson = wire.rawJson ?: "{}",
                    capturedImage = consumeImage(wire.imagePath),
                )
            "liveness" ->
                IappEkycResult.LivenessPassed(
                    rawJson = wire.rawJson ?: "{}",
                    verdictJson = wire.verdictJson ?: "{}",
                    passed = wire.passed,
                    signature = wire.signature.orEmpty(),
                    signatureAlg = wire.signatureAlg.orEmpty(),
                    selfieImage = consumeImage(wire.imagePath),
                )
            "face" -> {
                val image = consumeImage(wire.imagePath)
                if (image == null) {
                    IappEkycResult.Failed(
                        IappEkycError(
                            code = EkycErrorCode.UNKNOWN,
                            statusCode = null,
                            messageKey = "error_generic",
                            message = "Face capture image handoff failed",
                        ))
                } else {
                    IappEkycResult.FaceCaptured(image)
                }
            }
            "failed" ->
                IappEkycResult.Failed(
                    wire.error
                        ?: IappEkycError(
                            code = EkycErrorCode.UNKNOWN,
                            statusCode = null,
                            messageKey = "error_generic",
                            message = "Unknown failure",
                        ))
            else -> IappEkycResult.Cancelled
        }
    }
}
