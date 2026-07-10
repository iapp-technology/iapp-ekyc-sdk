// Root Gradle build for JitPack / Maven publishing of the Android library.
// Contains ONLY :ekyc-sdk — flutter/example/android and android/example are
// standalone Gradle projects with their own settings files (Gradle stops
// settings discovery there, so they are unaffected by this file).
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "iapp-ekyc-sdk"

include(":ekyc-sdk")
project(":ekyc-sdk").projectDir = file("android/ekyc-sdk")
