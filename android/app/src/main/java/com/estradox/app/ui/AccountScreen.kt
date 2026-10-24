package com.estradox.app.ui

import android.content.Intent
import android.provider.Settings
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import com.estradox.app.BuildConfig
import com.estradox.app.notify.Notifier
import kotlinx.coroutines.launch

private val ESTADO_PAGO = mapOf(
    "PAID" to "Aprobado", "ACTIVE" to "Pendiente", "PROCESSING" to "En proceso",
    "REJECTED" to "Rechazado", "CANCELLED" to "Cancelado", "EXPIRED" to "Expirado",
)

@Composable
fun AccountScreen() {
    val state = LocalAppState.current
    val scope = rememberCoroutineScope()
    val sub = rememberLoader { state.api.subscription() }
    val perfil = state.perfil
    var confirmLogout by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf(false) }

    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        item { Text("Cuenta", style = MaterialTheme.typography.headlineSmall) }
        item {
            SectionCard(title = "Mi cuenta") {
                Field("Nombre", perfil?.user?.displayName ?: "—")
                Field("Correo", perfil?.user?.email ?: "—")
            }
        }
        item {
            SectionCard(title = "Suscripción") {
                val s = sub.data?.suscripcion ?: perfil?.suscripcion
                if (s == null) {
                    EmptyText("Cargando…")
                } else {
                    val titulo = when (s.estado) {
                        "admin" -> "Cuenta administradora (sin cobro)"
                        "prueba" -> "Prueba gratis activa"
                        "activa" -> "Plan activo"
                        else -> "Tu acceso venció"
                    }
                    Text(titulo, fontWeight = FontWeight.SemiBold)
                    if (s.estado != "admin") {
                        Text(
                            (if (s.vencida) "Venció el " else "Tienes acceso hasta el ") + fechaLarga(s.accesoHasta) +
                                (if (!s.vencida) " (${s.diasRestantes} día(s))" else ""),
                            color = Brand.Muted,
                        )
                    }
                }
                val pagos = sub.data?.pagos.orEmpty()
                if (pagos.isNotEmpty()) {
                    Spacer(Modifier.height(12.dp))
                    Text("Historial de pagos", style = MaterialTheme.typography.titleSmall)
                    pagos.forEach { p ->
                        HorizontalDivider(color = Brand.Border, modifier = Modifier.padding(vertical = 6.dp))
                        Row {
                            Column(Modifier.weight(1f)) {
                                Text(if (p.meses == 1) "1 mes" else "${p.meses} meses")
                                Text(fecha(p.fecha), color = Brand.Muted, style = MaterialTheme.typography.bodySmall)
                            }
                            Column(horizontalAlignment = Alignment.End) {
                                Text(pesos(p.amount))
                                Text(ESTADO_PAGO[p.status] ?: p.status, color = Brand.Muted, style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    }
                }
            }
        }
        item { WhatsappCard(perfil?.user?.whatsapp) }
        item { NotificationsCard() }
        item { PasswordCard() }
        item {
            SectionCard {
                SecondaryButton("Cerrar sesión", { confirmLogout = true }, Modifier.fillMaxWidth())
                if (perfil?.user?.isAdmin != true) {
                    TextButton(onClick = { deleting = true }, modifier = Modifier.align(Alignment.CenterHorizontally)) {
                        Text("Eliminar mi cuenta", color = Brand.Red)
                    }
                }
            }
        }
        item {
            Text(
                "Estradox ${BuildConfig.VERSION_NAME}",
                color = Brand.Muted,
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp),
            )
        }
    }

    if (confirmLogout) {
        AlertDialog(
            onDismissRequest = { confirmLogout = false },
            title = { Text("Cerrar sesión") },
            text = { Text("Dejarás de recibir notificaciones en este teléfono hasta que vuelvas a ingresar.") },
            confirmButton = {
                TextButton(onClick = { confirmLogout = false; scope.launch { state.logout() } }) { Text("Cerrar sesión") }
            },
            dismissButton = { TextButton(onClick = { confirmLogout = false }) { Text("Cancelar") } },
        )
    }
    if (deleting) DeleteAccountDialog(onDismiss = { deleting = false })
}

@Composable
private fun Field(label: String, value: String) {
    Column(Modifier.padding(vertical = 4.dp)) {
        Text(label, color = Brand.Muted, style = MaterialTheme.typography.bodySmall)
        Text(value)
    }
}

@Composable
private fun WhatsappCard(current: String?) {
    val state = LocalAppState.current
    val scope = rememberCoroutineScope()
    var value by remember(current) { mutableStateOf(current.orEmpty()) }
    var loading by remember { mutableStateOf(false) }
    var msg by remember { mutableStateOf<Pair<String, Boolean>?>(null) }
    SectionCard(title = "WhatsApp") {
        if (current == null) {
            Text(
                "Aún no has registrado tu número. Agrégalo para que podamos contactarte.",
                color = Brand.Muted,
                style = MaterialTheme.typography.bodySmall,
            )
            Spacer(Modifier.height(8.dp))
        }
        FormField(value, { value = it }, "Número de WhatsApp", keyboardType = KeyboardType.Phone, placeholder = "300 123 4567")
        msg?.let { Message(it.first, ok = it.second) }
        Spacer(Modifier.height(12.dp))
        GradientButton(
            "Guardar",
            onClick = {
                scope.launch {
                    loading = true
                    msg = try {
                        val r = state.api.setWhatsapp(value)
                        state.refreshPerfil()
                        r.ok to true
                    } catch (e: Exception) {
                        state.message(e) to false
                    }
                    loading = false
                }
            },
            enabled = value.isNotBlank() && value != current,
            loading = loading,
        )
    }
}

@Composable
private fun NotificationsCard() {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var enabled by remember { mutableStateOf(Notifier.canNotify(context)) }
    // Se revisa de nuevo al volver de los ajustes del sistema.
    LaunchedEffect(lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) { enabled = Notifier.canNotify(context) }
    }
    SectionCard(title = "Notificaciones") {
        Text(
            if (enabled) "Activadas. Te avisamos en este teléfono cuando tus procesos tengan actuaciones nuevas."
            else "Desactivadas. Actívalas para enterarte de las actuaciones nuevas de tus procesos.",
            color = Brand.Muted,
        )
        Spacer(Modifier.height(10.dp))
        SecondaryButton(
            if (enabled) "Ajustes de notificaciones" else "Activar notificaciones",
            {
                context.startActivity(
                    Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                        .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName),
                )
            },
        )
    }
}

@Composable
private fun PasswordCard() {
    val state = LocalAppState.current
    val scope = rememberCoroutineScope()
    var current by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var password2 by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var msg by remember { mutableStateOf<Pair<String, Boolean>?>(null) }
    SectionCard(title = "Cambiar contraseña") {
        FormField(current, { current = it }, "Contraseña actual", password = true)
        Spacer(Modifier.height(8.dp))
        FormField(password, { password = it }, "Nueva contraseña", password = true, placeholder = "Mínimo 8, con letras y números")
        Spacer(Modifier.height(8.dp))
        FormField(password2, { password2 = it }, "Repetir nueva contraseña", password = true)
        msg?.let { Message(it.first, ok = it.second) }
        Spacer(Modifier.height(12.dp))
        GradientButton(
            "Actualizar contraseña",
            onClick = {
                if (password != password2) {
                    msg = "Las contraseñas no coinciden." to false
                    return@GradientButton
                }
                scope.launch {
                    loading = true
                    msg = try {
                        val ok = state.api.changePassword(current, password).ok.orEmpty()
                        current = ""; password = ""; password2 = ""
                        ok to true
                    } catch (e: Exception) {
                        state.message(e) to false
                    }
                    loading = false
                }
            },
            enabled = current.isNotEmpty() && password.isNotEmpty(),
            loading = loading,
        )
    }
}

@Composable
private fun DeleteAccountDialog(onDismiss: () -> Unit) {
    val state = LocalAppState.current
    val scope = rememberCoroutineScope()
    var password by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    AlertDialog(
        onDismissRequest = { if (!loading) onDismiss() },
        title = { Text("Eliminar cuenta") },
        text = {
            Column {
                Text(
                    "Se eliminan tu cuenta, tus procesos, actuaciones y documentos guardados. No se puede deshacer.",
                    color = Brand.Muted,
                )
                Spacer(Modifier.height(12.dp))
                FormField(password, { password = it }, "Confirma con tu contraseña", password = true)
                Message(error)
            }
        },
        confirmButton = {
            TextButton(
                enabled = password.isNotEmpty() && !loading,
                onClick = {
                    scope.launch {
                        loading = true
                        try {
                            state.api.deleteAccount(password)
                            state.endSession()
                        } catch (e: Exception) {
                            error = state.message(e)
                        }
                        loading = false
                    }
                },
            ) { Text(if (loading) "Eliminando…" else "Eliminar", color = Brand.Red, fontWeight = FontWeight.SemiBold) }
        },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !loading) { Text("Cancelar") } },
    )
}
