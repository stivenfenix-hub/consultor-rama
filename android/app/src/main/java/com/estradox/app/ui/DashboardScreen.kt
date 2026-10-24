package com.estradox.app.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.estradox.app.data.Dashboard
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DashboardScreen(openCase: (String) -> Unit, openCases: () -> Unit) {
    val state = LocalAppState.current
    val loader = rememberLoader { state.api.dashboard() }
    val data = loader.data

    PullToRefreshBox(
        isRefreshing = loader.loading && data != null,
        onRefresh = loader::reload,
        modifier = Modifier.fillMaxSize(),
    ) {
        when {
            data != null -> DashboardContent(data, openCase, openCases, onRefreshed = loader::reload)
            loader.error != null -> ErrorBox(loader.error!!, loader::reload)
            else -> LoadingBox()
        }
    }
}

@Composable
private fun DashboardContent(d: Dashboard, openCase: (String) -> Unit, openCases: () -> Unit, onRefreshed: () -> Unit) {
    val state = LocalAppState.current
    val sub = state.perfil?.suscripcion
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Wordmark(22)
                    val nombre = state.perfil?.user?.firstName ?: state.perfil?.user?.displayName
                    if (nombre != null) Text("Hola, $nombre", color = Brand.Muted)
                }
            }
        }
        // Aviso de días de prueba o plan por vencer (solo informativo).
        if (sub != null && (sub.estado == "prueba" || (sub.estado == "activa" && sub.diasRestantes <= 5))) {
            item {
                Surface(shape = RoundedCornerShape(12.dp), color = Brand.Accent.copy(alpha = 0.16f)) {
                    Text(
                        if (sub.estado == "prueba") "Prueba gratis: te quedan ${sub.diasRestantes} día(s)."
                        else "Tu plan vence en ${sub.diasRestantes} día(s).",
                        modifier = Modifier.fillMaxWidth().padding(12.dp),
                    )
                }
            }
        }
        item { DashboardActions(d, openCases, onRefreshed) }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                StatTile("Procesos activos", d.stats.totalProcesos, Modifier.weight(1f))
                StatTile("Actuaciones este mes", d.stats.actuacionesEsteMes, Modifier.weight(1f), Brand.Accent)
            }
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                StatTile("Procesos nuevos este mes", d.stats.nuevosEsteMes, Modifier.weight(1f))
                StatTile(
                    "Actuaciones sin ver", d.stats.sinVer, Modifier.weight(1f),
                    if (d.stats.sinVer > 0) Brand.Green else null,
                )
            }
        }
        item {
            SectionCard(title = "Antigüedad de la última actuación") {
                val b = d.stats.buckets
                BucketBar(
                    listOf(
                        Triple("0–6 meses", b.b0_6, Brand.Green),
                        Triple("6–12 meses", b.b6_12, Brand.Amber),
                        Triple("Más de 12 meses", b.b12, Brand.Red),
                        Triple("Sin actuación", b.sin, Brand.Muted),
                    ),
                )
            }
        }
        item { SectionCard(title = "Procesos por clase") { Donut(d.stats.porClase) } }
        item { SectionCard(title = "Procesos por departamento") { Donut(d.stats.porDepartamento) } }
        item {
            SectionCard {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Actuación reciente", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                    TextButton(onClick = openCases) { Text("Ver todos") }
                }
                if (d.recientes.isEmpty()) {
                    EmptyText("Aún no sigues procesos. Agrega el primero en Procesos.")
                }
                d.recientes.forEachIndexed { i, c ->
                    if (i > 0) HorizontalDivider(color = Brand.Border)
                    Column(
                        Modifier
                            .fillMaxWidth()
                            .clickable { openCase(c.id) }
                            .padding(vertical = 10.dp),
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(radicadoLegible(c.radicado), style = Mono, modifier = Modifier.weight(1f))
                            if (c.unseenCount > 0) Pill("${c.unseenCount} nuevas", Brand.Green, filled = true)
                        }
                        Text(
                            "${fecha(c.lastActuacionDate)} · ${c.ultimaActuacion ?: "—"}",
                            color = Brand.Muted,
                            style = MaterialTheme.typography.bodySmall,
                            maxLines = 2,
                        )
                    }
                }
            }
        }
    }
}

/** "Actualizar todos" (una vez por semana) y acceso rápido para agregar procesos. */
@Composable
private fun DashboardActions(d: Dashboard, openCases: () -> Unit, onRefreshed: () -> Unit) {
    val state = LocalAppState.current
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var confirm by remember { mutableStateOf(false) }
    var msg by remember { mutableStateOf<Pair<String, Boolean>?>(null) }
    val ra = d.refreshAll

    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        OutlinedButton(
            onClick = { confirm = true },
            enabled = !busy && !ra.enCurso && ra.disponibleEn == null,
            modifier = Modifier.weight(1f),
            shape = RoundedCornerShape(12.dp),
            border = androidx.compose.foundation.BorderStroke(1.dp, Brand.Border),
        ) {
            Icon(Icons.Outlined.Refresh, null)
            Spacer(Modifier.width(6.dp))
            Text(if (ra.enCurso) "Actualizando…" else "Actualizar todos", color = Brand.Text)
        }
        OutlinedButton(
            onClick = openCases,
            modifier = Modifier.weight(1f),
            shape = RoundedCornerShape(12.dp),
            border = androidx.compose.foundation.BorderStroke(1.dp, Brand.Border),
        ) {
            Icon(Icons.Outlined.Add, null)
            Spacer(Modifier.width(6.dp))
            Text("Agregar", color = Brand.Text)
        }
    }
    when {
        msg != null -> Message(msg!!.first, ok = msg!!.second)
        ra.disponibleEn != null -> Text(
            "Ya usaste la actualización de esta semana. Disponible de nuevo el ${fechaHora(ra.disponibleEn)}.",
            color = Brand.Muted,
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.padding(top = 6.dp),
        )
    }

    if (confirm) {
        AlertDialog(
            onDismissRequest = { confirm = false },
            title = { Text("Actualizar todos") },
            text = {
                Text(
                    "Consultaremos en la Rama Judicial todos tus procesos en segundo plano. " +
                        "Puedes usarlo una vez por semana; la revisión diaria automática sigue funcionando.",
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    confirm = false
                    scope.launch {
                        busy = true
                        msg = try {
                            state.api.refreshAll().ok.orEmpty() to true
                        } catch (e: Exception) {
                            state.message(e) to false
                        }
                        busy = false
                        onRefreshed()
                    }
                }) { Text("Actualizar", fontWeight = FontWeight.SemiBold) }
            },
            dismissButton = { TextButton(onClick = { confirm = false }) { Text("Cancelar") } },
        )
    }
}
