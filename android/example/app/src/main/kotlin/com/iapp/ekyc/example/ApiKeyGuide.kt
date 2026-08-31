package com.iapp.ekyc.example

import com.iapp.ekyc.IappEkycConfig

/**
 * The example is built with `-PiappApiKey=...` (see app/build.gradle.kts).
 * Without it the flows would run all the way through the camera UX and then
 * fail with INVALID_API_KEY at the final API call -- so both screens show
 * this guide up front instead of letting that happen.
 */
object ApiKeyGuide {
    @JvmStatic
    fun isConfigured(key: String): Boolean =
        key.isNotBlank() && key != IappEkycConfig.PLACEHOLDER_API_KEY

    const val TEXT: String =
        "API key missing - this build uses the placeholder YOUR_API_KEY, so every " +
            "flow would end with INVALID_API_KEY.\n\n" +
            "1. Get a key: sign in at https://iapp.co.th, open Control Panel > API Keys " +
            "(https://iapp.co.th/control/api-keys) and create one. New accounts include " +
            "free credits.\n\n" +
            "2. Rebuild this example with your key:\n" +
            "   ./gradlew :app:installDebug -PiappApiKey=iapp_live_...\n" +
            "   (or: export IAPP_API_KEY=iapp_live_... before building)\n\n" +
            "3. In your own app, pass it directly:\n" +
            "   IappEkycConfig.Builder(\"iapp_live_...\")"
}
