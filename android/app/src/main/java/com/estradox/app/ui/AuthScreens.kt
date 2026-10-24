package com.estradox.app.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.estradox.app.R
import com.estradox.app.data.ApiException
import kotlinx.coroutines.launch

/** Inicio de sesión, registro y recuperación de contraseña. */
@Composable
fun AuthFlow() {
    val nav = rememberNavController()
    NavHost(nav, startDestination = "login") {
        composable("login") {
            LoginScreen(onRegister = { nav.navigate("register") }, onForgot = { nav.navigate("forgot") })
        }
        composable("register") { RegisterScreen(onDone = { nav.popBackStack() }) }
        composable("forgot") { ForgotScreen(onBack = { nav.popBackStack() }) }
    }
}

@Composable
private fun AuthColumn(subtitle: String, content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier
            .fillMaxSize()
            .systemBarsPadding()
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(32.dp))
        Image(painterResource(R.drawable.ic_launcher_foreground), contentDescription = null, modifier = Modifier.size(96.dp))
        Wordmark()
        Spacer(Modifier.height(6.dp))
        Text(subtitle, color = Brand.Muted, textAlign = TextAlign.Center)
        Spacer(Modifier.height(28.dp))
        Column(Modifier.widthIn(max = 460.dp).fillMaxWidth()) { content() }
    }
}

@Composable
private fun LoginScreen(onRegister: () -> Unit, onForgot: () -> Unit) {
    val state = LocalAppState.current
    val scope = rememberCoroutineScope()
    var email by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var info by remember { mutableStateOf<String?>(null) }
    var needsVerify by remember { mutableStateOf(false) }

    fun login() {
        if (email.isBlank() || password.isBlank()) {
            error = "Ingresa correo y contraseña."
            return
        }
        scope.launch {
            loading = true; error = null; info = null; needsVerify = false
            try {
                state.onLogin(state.api.login(email.trim(), password))
            } catch (e: ApiException) {
                error = e.message
                needsVerify = e.field == "verify"
            } catch (e: Exception) {
                error = state.message(e)
            }
            loading = false
        }
    }

    AuthColumn("Tus procesos judiciales al día, directo desde la Rama Judicial.") {
        FormField(email, { email = it.trim() }, "Correo", keyboardType = KeyboardType.Email)
        Spacer(Modifier.height(12.dp))
        FormField(password, { password = it }, "Contraseña", password = true)
        Message(error)
        Message(info, ok = true)
        if (needsVerify) {
            TextButton(onClick = {
                scope.launch {
                    info = runCatching { state.api.resendVerification(email.trim()).ok }.getOrNull()
                    error = null
                }
            }) { Text("Reenviar correo de verificación") }
        }
        Spacer(Modifier.height(20.dp))
        GradientButton("Iniciar sesión", ::login, Modifier.fillMaxWidth(), loading = loading)
        Spacer(Modifier.height(8.dp))
        TextButton(onClick = onForgot, modifier = Modifier.align(Alignment.CenterHorizontally)) {
            Text("¿Olvidaste tu contraseña?")
        }
        Spacer(Modifier.height(12.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
            Text("¿No tienes cuenta?", color = Brand.Muted)
            TextButton(onClick = onRegister) { Text("Crear cuenta") }
        }
    }
}

@Composable
private fun RegisterScreen(onDone: () -> Unit) {
    val state = LocalAppState.current
    val scope = rememberCoroutineScope()
    var firstName by rememberSaveable { mutableStateOf("") }
    var lastName by rememberSaveable { mutableStateOf("") }
    var email by rememberSaveable { mutableStateOf("") }
    var whatsapp by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var password2 by rememberSaveable { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var errorField by remember { mutableStateOf<String?>(null) }
    var done by remember { mutableStateOf<String?>(null) }

    AuthColumn("Crea tu cuenta y prueba Estradox gratis.") {
        if (done != null) {
            Message(done, ok = true)
            Spacer(Modifier.height(20.dp))
            GradientButton("Ir a iniciar sesión", onDone, Modifier.fillMaxWidth())
            return@AuthColumn
        }
        FormField(firstName, { firstName = it }, "Nombre", isError = errorField == "firstName")
        Spacer(Modifier.height(10.dp))
        FormField(lastName, { lastName = it }, "Apellido", isError = errorField == "lastName")
        Spacer(Modifier.height(10.dp))
        FormField(email, { email = it.trim() }, "Correo", keyboardType = KeyboardType.Email, isError = errorField == "email")
        Spacer(Modifier.height(10.dp))
        FormField(
            whatsapp, { whatsapp = it }, "WhatsApp", keyboardType = KeyboardType.Phone,
            placeholder = "300 123 4567", isError = errorField == "whatsapp",
        )
        Spacer(Modifier.height(10.dp))
        FormField(
            password, { password = it }, "Contraseña", password = true,
            placeholder = "Mínimo 8, con letras y números", isError = errorField == "password",
        )
        Spacer(Modifier.height(10.dp))
        FormField(password2, { password2 = it }, "Repetir contraseña", password = true, isError = errorField == "password2")
        Message(error)
        Spacer(Modifier.height(20.dp))
        GradientButton(
            "Crear cuenta",
            onClick = {
                if (password != password2) {
                    error = "Las contraseñas no coinciden."; errorField = "password2"
                    return@GradientButton
                }
                scope.launch {
                    loading = true; error = null; errorField = null
                    try {
                        done = state.api.register(firstName.trim(), lastName.trim(), email.trim(), whatsapp, password).ok
                    } catch (e: ApiException) {
                        error = e.message; errorField = e.field
                    } catch (e: Exception) {
                        error = state.message(e)
                    }
                    loading = false
                }
            },
            modifier = Modifier.fillMaxWidth(),
            loading = loading,
        )
        TextButton(onClick = onDone, modifier = Modifier.align(Alignment.CenterHorizontally)) {
            Text("Ya tengo cuenta")
        }
    }
}

@Composable
private fun ForgotScreen(onBack: () -> Unit) {
    val state = LocalAppState.current
    val scope = rememberCoroutineScope()
    var email by rememberSaveable { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var msg by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    AuthColumn("Te enviaremos un enlace a tu correo para crear una nueva contraseña.") {
        FormField(email, { email = it.trim() }, "Correo", keyboardType = KeyboardType.Email)
        Message(msg, ok = true)
        Message(error)
        Spacer(Modifier.height(20.dp))
        GradientButton(
            "Enviar enlace",
            onClick = {
                scope.launch {
                    loading = true; error = null
                    try {
                        msg = state.api.forgot(email.trim()).ok
                    } catch (e: Exception) {
                        error = state.message(e)
                    }
                    loading = false
                }
            },
            modifier = Modifier.fillMaxWidth(),
            enabled = email.contains("@"),
            loading = loading,
        )
        TextButton(onClick = onBack, modifier = Modifier.align(Alignment.CenterHorizontally)) {
            Text("Volver a iniciar sesión", style = MaterialTheme.typography.labelLarge)
        }
    }
}
