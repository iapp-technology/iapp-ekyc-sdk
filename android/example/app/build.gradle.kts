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
