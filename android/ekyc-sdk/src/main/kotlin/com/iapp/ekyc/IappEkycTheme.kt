package com.iapp.ekyc

import android.os.Parcelable
import kotlinx.parcelize.Parcelize

/**
 * Theme token overrides, mapped 1:1 to the engine's `--iapp-ekyc-*` CSS
 * custom properties (docs/THEMING.md). Null keeps the engine default.
 */
@Parcelize
class IappEkycTheme private constructor(
    val primary: String?,
    val primaryDark: String?,
    val primaryLight: String?,
    val surface: String?,
    val onPrimary: String?,
    val success: String?,
    val warning: String?,
    val error: String?,
    val overlayScrim: String?,
    val brandDeep: String?,
    val fontFamily: String?,
    /** Corner radius in px. */
    val borderRadius: Int?,
    /** Guide stroke width in px. */
    val guideStrokeWidth: Int?,
) : Parcelable {

    class Builder {
        private var primary: String? = null
        private var primaryDark: String? = null
        private var primaryLight: String? = null
        private var surface: String? = null
        private var onPrimary: String? = null
        private var success: String? = null
        private var warning: String? = null
        private var error: String? = null
        private var overlayScrim: String? = null
        private var brandDeep: String? = null
        private var fontFamily: String? = null
        private var borderRadius: Int? = null
        private var guideStrokeWidth: Int? = null

        fun primary(value: String) = apply { primary = value }

        fun primaryDark(value: String) = apply { primaryDark = value }

        fun primaryLight(value: String) = apply { primaryLight = value }

        fun surface(value: String) = apply { surface = value }

        fun onPrimary(value: String) = apply { onPrimary = value }

        fun success(value: String) = apply { success = value }

        fun warning(value: String) = apply { warning = value }

        fun error(value: String) = apply { error = value }

        fun overlayScrim(value: String) = apply { overlayScrim = value }

        fun brandDeep(value: String) = apply { brandDeep = value }

        fun fontFamily(value: String) = apply { fontFamily = value }

        fun borderRadius(px: Int) = apply { borderRadius = px }

        fun guideStrokeWidth(px: Int) = apply { guideStrokeWidth = px }

        fun build() =
            IappEkycTheme(
                primary, primaryDark, primaryLight, surface, onPrimary, success,
                warning, error, overlayScrim, brandDeep, fontFamily, borderRadius,
                guideStrokeWidth,
            )
    }

    internal fun asPairs(): List<Pair<String, Any>> =
        listOfNotNull(
            primary?.let { "primary" to it },
            primaryDark?.let { "primaryDark" to it },
            primaryLight?.let { "primaryLight" to it },
            surface?.let { "surface" to it },
            onPrimary?.let { "onPrimary" to it },
            success?.let { "success" to it },
            warning?.let { "warning" to it },
            error?.let { "error" to it },
            overlayScrim?.let { "overlayScrim" to it },
            brandDeep?.let { "brandDeep" to it },
            fontFamily?.let { "fontFamily" to it },
            borderRadius?.let { "borderRadius" to it },
            guideStrokeWidth?.let { "guideStrokeWidth" to it },
        )
}
