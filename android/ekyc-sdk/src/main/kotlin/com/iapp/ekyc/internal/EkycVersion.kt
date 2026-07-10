package com.iapp.ekyc.internal

internal object EkycVersion {
    /** Wrapper version, reported as `sdk.version = "<wrapper>+engine.<engine>"`. */
    const val WRAPPER_VERSION = "0.2.0"

    /** Engine (web SDK) version this wrapper release was tested against. */
    const val ENGINE_VERSION = "0.2.0"

    const val PROTOCOL_VERSION = 1

    /** The single host-page version this wrapper understands. */
    const val SUPPORTED_HOST_PAGE_VERSION = 1

    const val DEFAULT_HOST_PAGE_URL = "https://iapp.co.th/sdk/webview.html"
}
