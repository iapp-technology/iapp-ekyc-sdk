plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.iapp.ekyc.example"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.iapp.ekyc.example"
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "0.2.0"

        // Build with your own key without editing source (and without ever
        // committing it):  ./gradlew :app:installDebug -PiappApiKey=iapp_live_...
        // or export IAPP_API_KEY=... . Falls back to a placeholder that the
        // API rejects with INVALID_API_KEY at the final step.
        val apiKey = (project.findProperty("iappApiKey") as String?)
            ?: System.getenv("IAPP_API_KEY")
            ?: "YOUR_API_KEY"
        buildConfigField("String", "IAPP_API_KEY", "\"$apiKey\"")
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation(project(":ekyc-sdk"))
    implementation("androidx.activity:activity-ktx:1.9.3")
}
