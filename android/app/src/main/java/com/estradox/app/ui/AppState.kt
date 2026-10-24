package com.estradox.app.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import com.estradox.app.EstradoxApp
import com.estradox.app.data.ApiException
import com.estradox.app.data.LoginResponse
import com.estradox.app.data.Perfil
import com.estradox.app.notify.NoticeWorker
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/** Estado global de la sesión, compartido por todas las pantallas. */
class AppState(val app: EstradoxApp) {
    val api get() = app.api

    var loggedIn by mutableStateOf(app.session.token != null)
        private set
    var perfil by mutableStateOf<Perfil?>(null)
    /** El servidor respondió 402: la prueba o el plan vencieron. */
    var expired by mutableStateOf(false)

    /** Ruta pendiente de abrir (al tocar una notificación). */
    var pendingUrl by mutableStateOf<String?>(null)

    suspend fun onLogin(res: LoginResponse) {
        app.session.token = res.token
        app.session.lastNoticeId = null
        perfil = Perfil(res.user, res.suscripcion)
        expired = res.suscripcion.vencida
        loggedIn = true
        // Marca desde dónde avisar y deja programada la revisión en segundo plano.
        runCatching { NoticeWorker.checkNow(app) }
        NoticeWorker.schedule(app)
    }

    suspend fun refreshPerfil() {
        val p = api.me()
        perfil = p
        expired = p.suscripcion.vencida
    }

    suspend fun logout() {
        api.logout()
        endSession()
    }

    /** Cierra la sesión local (token vencido, cuenta eliminada o "Cerrar sesión"). */
    fun endSession() {
        app.session.clear()
        NoticeWorker.cancel(app)
        perfil = null
        expired = false
        loggedIn = false
    }

    /** Mensaje para mostrar; además reacciona a la sesión vencida (401) o al acceso vencido (402). */
    fun message(e: Throwable): String {
        if (e is ApiException) {
            when (e.status) {
                401 -> endSession()
                402 -> expired = true
            }
            return e.message ?: "Ocurrió un error."
        }
        return "Ocurrió un error. Intenta de nuevo."
    }
}

val LocalAppState = staticCompositionLocalOf<AppState> { error("AppState no disponible") }

/** Carga datos del API con estado de carga/error y la opción de recargar. */
class Loader<T>(
    private val scope: CoroutineScope,
    private val state: AppState,
    private val fetch: suspend () -> T,
) {
    var data by mutableStateOf<T?>(null)
    var error by mutableStateOf<String?>(null)
    var loading by mutableStateOf(false)
        private set

    fun reload() {
        scope.launch {
            loading = true
            error = null
            try {
                data = fetch()
            } catch (e: Exception) {
                error = state.message(e)
            }
            loading = false
        }
    }
}

@Composable
fun <T> rememberLoader(vararg keys: Any?, fetch: suspend () -> T): Loader<T> {
    val scope = rememberCoroutineScope()
    val state = LocalAppState.current
    val loader = remember(*keys) { Loader(scope, state, fetch) }
    LaunchedEffect(loader) { loader.reload() }
    return loader
}
