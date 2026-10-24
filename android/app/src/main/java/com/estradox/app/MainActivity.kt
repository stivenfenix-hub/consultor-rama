package com.estradox.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import com.estradox.app.notify.Notifier
import com.estradox.app.ui.AppState
import com.estradox.app.ui.AuthFlow
import com.estradox.app.ui.Brand
import com.estradox.app.ui.EstradoxTheme
import com.estradox.app.ui.LocalAppState
import com.estradox.app.ui.MainFlow

class MainActivity : ComponentActivity() {
    private lateinit var state: AppState

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        state = AppState(application as EstradoxApp)
        handle(intent)
        setContent {
            EstradoxTheme {
                CompositionLocalProvider(LocalAppState provides state) {
                    Surface(Modifier.fillMaxSize(), color = Brand.Bg) {
                        if (state.loggedIn) MainFlow() else AuthFlow()
                    }
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    /** Al tocar una notificación se abre la pantalla que indica su enlace. */
    private fun handle(intent: Intent?) {
        intent?.getStringExtra(Notifier.EXTRA_URL)?.let { state.pendingUrl = it }
    }
}
