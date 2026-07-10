package com.iapp.ekyc

import android.content.Context
import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResultLauncher
import com.iapp.ekyc.internal.ResultFiles
import java.util.UUID

/**
 * Simple callback entry point (Java-friendly). For configuration-change /
 * process-death safety prefer [IappEkycContract] with
 * `registerForActivityResult` — this helper registers on the fly, so a
 * result delivered after process death is dropped.
 */
object IappEkyc {
    @JvmStatic
    fun start(activity: ComponentActivity, request: IappEkycRequest, callback: IappEkycCallback) {
        var launcher: ActivityResultLauncher<IappEkycRequest>? = null
        launcher =
            activity.activityResultRegistry.register(
                "iapp_ekyc_${UUID.randomUUID()}", IappEkycContract()) { result ->
                    launcher?.unregister()
                    when (result) {
                        is IappEkycResult.Failed -> callback.onError(result.error)
                        IappEkycResult.Cancelled -> callback.onCancelled()
                        else -> callback.onResult(result)
                    }
                }
        launcher.launch(request)
    }

    /** Sweep leftover image-handoff cache files (e.g. after process death). */
    @JvmStatic
    fun clearCache(context: Context) {
        ResultFiles.clear(context)
    }
}
