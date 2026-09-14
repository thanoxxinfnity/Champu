plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "com.chomugiri.workspace"
    compileSdk = 35
    // Pinned: without it AGP downloads its own default mid-build, which stalls on
    // restricted networks and makes the build non-reproducible.
    buildToolsVersion = "35.0.0"

    defaultConfig {
        applicationId = "com.chomugiri.workspace"
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
        debug {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions { jvmTarget = "17" }

    testOptions {
        unitTests {
            // The server and router are plain JVM code behind the Ports seams;
            // the few android.* calls that remain should no-op rather than throw.
            isReturnDefaultValues = true
        }
    }

    // The web bundle is already gzip-friendly text; letting aapt compress it
    // again just costs decompression time on every asset read.
    androidResources {
        noCompress += listOf("woff2")
    }

    packaging {
        resources { excludes += "/META-INF/{AL2.0,LGPL2.1}" }
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.activity)
    implementation(libs.androidx.appcompat)
    implementation(libs.androidx.webkit)
    // Typed request/response models. Hand-rolled optString() parsing is how a
    // field named owned_by silently became null, and how a missing envelope
    // shape became "this endpoint answered nothing".
    implementation(libs.kotlinx.serialization.json)

    // android.jar's org.json is a stub that throws; the real implementation is
    // needed for unit tests that exercise the API router end to end.
    testImplementation("org.json:json:20240303")
    testImplementation("junit:junit:4.13.2")
}
