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

rootProject.name = "iapp-ekyc-example"

include(":app")

// Build the SDK from source (a published app would use the JitPack artifact).
include(":ekyc-sdk")
project(":ekyc-sdk").projectDir = file("../ekyc-sdk")
