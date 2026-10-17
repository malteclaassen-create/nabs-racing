import groovy.json.JsonSlurper

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// The version lives in android/release.json, not here: the website reads the same
// file to tell an app that a newer one is out (backend/src/lib/androidRelease.js),
// and the release workflow names the GitHub release after it. One number, three readers.
@Suppress("UNCHECKED_CAST")
val release = JsonSlurper().parse(rootProject.file("release.json")) as Map<String, Any>

// The signing key never sits in the repository. CI gets it from the repository's
// secrets (.github/workflows/android.yml) and hands it over in these variables; a
// build without them still works, but its APK is unsigned and will not install.
val keystoreFile = System.getenv("NABS_KEYSTORE_FILE")?.takeIf { it.isNotBlank() }?.let { file(it) }
val keystorePassword = System.getenv("NABS_KEYSTORE_PASSWORD") ?: ""

android {
    namespace = "com.nabsracing.app"
    compileSdk = 36

    defaultConfig {
        // Never changes: Android tells apps apart by it, and the Play Store would
        // treat a different one as a different app.
        applicationId = "com.nabsracing.app"
        minSdk = 26
        targetSdk = 36
        versionCode = (release["versionCode"] as Number).toInt()
        versionName = release["versionName"] as String
        // ?app=android tells the site it is running in this app, and which version
        // of it, so it can say when a newer one is out (frontend AndroidAppNotice).
        resValue("string", "launchUrl", "https://nabsracing.com/?app=android&appv=$versionCode")
    }

    signingConfigs {
        if (keystoreFile != null) {
            create("release") {
                storeFile = keystoreFile
                storePassword = keystorePassword
                keyAlias = "nabs"
                keyPassword = keystorePassword
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        buildConfig = true
    }

    testOptions {
        unitTests.isIncludeAndroidResources = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    implementation("com.google.androidbrowserhelper:androidbrowserhelper:2.7.4")
    implementation("androidx.work:work-runtime-ktx:2.11.2")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.16.1")
}
