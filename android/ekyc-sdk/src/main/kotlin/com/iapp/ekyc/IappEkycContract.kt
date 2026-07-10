package com.iapp.ekyc

import android.content.Context
import android.content.Intent
import androidx.activity.result.contract.ActivityResultContract
import com.iapp.ekyc.internal.IappEkycActivity
import com.iapp.ekyc.internal.ResultFiles

/**
 * Canonical launcher — survives process death like any ActivityResult API:
 *
 * ```kotlin
 * private val ekyc = registerForActivityResult(IappEkycContract()) { result ->
 *     when (result) {
 *         is IappEkycResult.DocumentCaptured -> handle(result.rawJson)
 *         is IappEkycResult.Failed -> show(result.error)
 *         IappEkycResult.Cancelled -> {}
 *         else -> {}
 *     }
 * }
 * // later: ekyc.launch(IappEkycRequest.DocumentCapture(config, EkycDocumentType.THAI_ID_FRONT))
 * ```
 */
class IappEkycContract : ActivityResultContract<IappEkycRequest, IappEkycResult>() {
    override fun createIntent(context: Context, input: IappEkycRequest): Intent =
        IappEkycActivity.newIntent(context, input)

    override fun parseResult(resultCode: Int, intent: Intent?): IappEkycResult =
        ResultFiles.parse(resultCode, intent)
}
