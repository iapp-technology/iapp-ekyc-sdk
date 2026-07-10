package com.iapp.ekyc

/** Document types accepted by document capture (docs/API_CONTRACTS.md). */
enum class EkycDocumentType(internal val wireName: String) {
    THAI_ID_FRONT("thaiIdFront"),
    THAI_ID_BACK("thaiIdBack"),
    THAI_ID_WITH_SIGNATURE("thaiIdWithSignature"),
    THAI_DRIVER_LICENSE("thaiDriverLicense"),
    BOOK_BANK("bookBank"),
    PASSPORT("passport"),
}

/** UI language of the flow (engine i18n tables). */
enum class EkycLocale(internal val wireName: String) {
    EN("en"),
    TH("th"),
    ZH("zh"),
}

/** Which camera document capture opens (liveness always uses the front camera). */
enum class EkycCameraFacing(internal val wireName: String) {
    /** Rear camera (`environment`) — the default for documents. */
    BACK("environment"),

    /** Front camera (`user`). */
    FRONT("user"),
}

/** Stable error codes (docs/WEBVIEW_BRIDGE.md). */
enum class EkycErrorCode {
    UNKNOWN,
    BAD_REQUEST,
    INVALID_API_KEY,
    INSUFFICIENT_CREDIT,
    FILE_TOO_LARGE,
    RATE_LIMITED,
    SERVER_ERROR,
    NETWORK_ERROR,
    TIMEOUT,
    LIVENESS_FAILED,
    CAMERA_PERMISSION_DENIED,
    CAMERA_NOT_FOUND,
    INSECURE_CONTEXT,
    ENGINE_LOAD_FAILED,
    INVALID_CONFIG,
    HOST_PAGE_LOAD_FAILED,
    PROTOCOL_MISMATCH,
    ;

    internal companion object {
        /** Bridge `error.code` string → enum; unknown strings map to UNKNOWN. */
        fun fromBridge(code: String): EkycErrorCode =
            when (code) {
                "INVALID_STATE" -> INVALID_CONFIG
                else -> entries.firstOrNull { it.name == code } ?: UNKNOWN
            }
    }
}
