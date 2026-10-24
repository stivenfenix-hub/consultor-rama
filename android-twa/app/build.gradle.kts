import java.util.Properties

plugins {
    id("com.android.application")
}

// Firma con la llave de UNOR. Por defecto usa AutoReply/keystore.properties
// (fuera de este repo); se puede apuntar a otro con ESTRADOX_KEYSTORE_PROPS.
// La huella SHA-256 de esta llave debe coincidir con public/.well-known/assetlinks.json.
val keystoreFile = file(System.getenv("ESTRADOX_KEYSTORE_PROPS") ?: "../../../keystore.properties")
val keystoreProps = Properties().apply {
    if (keystoreFile.exists()) keystoreFile.inputStream().use { load(it) }
}

val host = "app.estradox.com"

android {
    // Mismo identificador que la app nativa (android/): en Play Store es una sola
    // ficha y la versión nativa puede reemplazar a esta como actualización.
    namespace = "com.estradox.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.estradox.app"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"

        manifestPlaceholders["hostName"] = host
        manifestPlaceholders["launchUrl"] = "https://$host/dashboard"
        resValue("string", "appName", "Estradox")
        resValue("string", "providerAuthority", "com.estradox.app.fileprovider")
        resValue(
            "string",
            "assetStatements",
            """[{ "relation": ["delegate_permission/common.handle_all_urls"], "target": {"namespace": "web", "site": "https://$host"}}]""",
        )
    }

    signingConfigs {
        if (keystoreProps.getProperty("storeFile") != null) {
            create("release") {
                storeFile = File(keystoreFile.parentFile, keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (keystoreProps.getProperty("storeFile") != null) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    // Trusted Web Activity: abre la plataforma a pantalla completa (Chrome) y
    // entrega sus notificaciones push como si fueran de la app.
    implementation("com.google.androidbrowserhelper:androidbrowserhelper:2.5.0")
}
