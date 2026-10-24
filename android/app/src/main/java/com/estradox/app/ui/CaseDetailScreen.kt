package com.estradox.app.ui

import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.DoneAll
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AssistChipDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.PrimaryScrollableTabRow
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.estradox.app.data.CaseDetail
import com.estradox.app.data.Documento
import kotlinx.coroutines.launch

private val TABS = listOf("Resumen", "Actuaciones", "Documentos", "Partes", "Grabaciones", "Sincronización")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CaseDetailScreen(caseId: String, onBack: () -> Unit, openDocument: (Documento) -> Unit) {
    val state = LocalAppState.current
    val scope = rememberCoroutineScope()
    val loader = rememberLoader(caseId) { state.api.case(caseId) }
    val snackbar = remember { SnackbarHostState() }
    val clipboard = LocalClipboardManager.current
    var tab by rememberSaveable { mutableStateOf(0) }
    var menu by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    var refreshing by remember { mutableStateOf(false) }
    val c = loader.data

    fun toast(msg: String) = scope.launch { snackbar.showSnackbar(msg) }

    Scaffold(
        containerColor = Brand.Bg,
        contentWindowInsets = WindowInsets(0),
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            TopAppBar(
                windowInsets = WindowInsets(0),
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Brand.Bg),
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Volver") }
                },
                title = {
                    Column {
                        Text("Proceso", style = MaterialTheme.typography.labelMedium, color = Brand.Muted)
                        Text(c?.radicado ?: "", style = Mono, maxLines = 1)
                    }
                },
                actions = {
                    if (c != null) {
                        val bloqueado = c.proximaActualizacion != null
                        IconButton(
                            enabled = !refreshing && !bloqueado,
                            onClick = {
                                scope.launch {
                                    refreshing = true
                                    try {
                                        val r = state.api.refreshCase(caseId)
                                        toast(if (r.nuevas > 0) "${r.ok} ${r.nuevas} actuación(es) nueva(s)." else r.ok)
                                        loader.reload()
                                    } catch (e: Exception) {
                                        toast(state.message(e))
                                    }
                                    refreshing = false
                                }
                            },
                        ) {
                            if (refreshing) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                            else Icon(Icons.Outlined.Refresh, if (bloqueado) "Actualizado hoy" else "Actualizar")
                        }
                        IconButton(onClick = { menu = true }) { Icon(Icons.Outlined.MoreVert, "Más opciones") }
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                            if (c.unseenCount > 0) {
                                DropdownMenuItem(
                                    text = { Text("Marcar vistas") },
                                    leadingIcon = { Icon(Icons.Outlined.DoneAll, null) },
                                    onClick = {
                                        menu = false
                                        scope.launch {
                                            runCatching { state.api.markSeen(caseId) }.onFailure { toast(state.message(it)) }
                                            loader.reload()
                                        }
                                    },
                                )
                            }
                            DropdownMenuItem(
                                text = { Text("Copiar radicado") },
                                leadingIcon = { Icon(Icons.Outlined.ContentCopy, null) },
                                onClick = {
                                    menu = false
                                    clipboard.setText(AnnotatedString(c.radicado))
                                    toast("Radicado copiado")
                                },
                            )
                            DropdownMenuItem(
                                text = { Text("Eliminar proceso", color = Brand.Red) },
                                leadingIcon = { Icon(Icons.Outlined.Delete, null, tint = Brand.Red) },
                                onClick = { menu = false; confirmDelete = true },
                            )
                        }
                    }
                },
            )
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            when {
                c != null -> {
                    PrimaryScrollableTabRow(
                        selectedTabIndex = tab,
                        containerColor = Brand.Bg,
                        edgePadding = 12.dp,
                    ) {
                        TABS.forEachIndexed { i, t ->
                            val label = when (i) {
                                1 -> "$t (${c.actuaciones.size})"
                                2 -> "$t (${c.documentos.size})"
                                else -> t
                            }
                            Tab(selected = tab == i, onClick = { tab = i }, text = { Text(label) })
                        }
                    }
                    LazyColumn(
                        Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(16.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        when (tab) {
                            0 -> resumen(c, onMarkSeen = {
                                scope.launch {
                                    runCatching { state.api.markSeen(caseId) }.onFailure { toast(state.message(it)) }
                                    loader.reload()
                                }
                            })
                            1 -> actuaciones(c, openDocument)
                            2 -> documentos(c, openDocument)
                            3 -> partes(c)
                            4 -> grabaciones(c)
                            5 -> sincronizacion(c)
                        }
                    }
                }
                loader.error != null -> ErrorBox(loader.error!!, loader::reload)
                else -> LoadingBox()
            }
        }
    }

    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("Eliminar proceso") },
            text = { Text("¿Eliminar este proceso de tu seguimiento? Dejarás de recibir sus actuaciones.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmDelete = false
                    scope.launch {
                        try {
                            state.api.deleteCase(caseId)
                            onBack()
                        } catch (e: Exception) {
                            toast(state.message(e))
                        }
                    }
                }) { Text("Eliminar", color = Brand.Red, fontWeight = FontWeight.SemiBold) }
            },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Cancelar") } },
        )
    }
}

private fun LazyListScope.resumen(c: CaseDetail, onMarkSeen: () -> Unit) {
    if (c.unseenCount > 0) {
        item {
            Surface(shape = RoundedCornerShape(12.dp), color = Brand.Green.copy(alpha = 0.14f)) {
                Row(Modifier.fillMaxWidth().padding(start = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("${c.unseenCount} actuación(es) nueva(s) sin ver", modifier = Modifier.weight(1f))
                    TextButton(onClick = onMarkSeen) { Text("Marcar vistas") }
                }
            }
        }
    }
    item {
        SectionCard(title = "Datos del proceso") {
            val filas = c.datos.map { it.label to it.value } +
                listOfNotNull(c.fechaProceso?.let { "Fecha del proceso" to fechaLarga(it) })
            filas.forEach { (label, value) ->
                Column(Modifier.padding(vertical = 5.dp)) {
                    Text(label, color = Brand.Muted, style = MaterialTheme.typography.bodySmall)
                    Text(value, style = MaterialTheme.typography.bodyMedium)
                }
            }
            if (filas.isEmpty()) EmptyText("La Rama no reporta datos para este proceso.")
        }
    }
    item {
        Text(
            "Sincronizado: ${fechaHora(c.lastSyncedAt)}" + (if (c.lastError != null) " · con errores" else ""),
            color = Brand.Muted,
            style = MaterialTheme.typography.bodySmall,
        )
        if (c.proximaActualizacion != null) {
            Text(
                "Ya se actualizó manualmente hoy. Disponible de nuevo mañana.",
                color = Brand.Muted,
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}

private fun LazyListScope.actuaciones(c: CaseDetail, openDocument: (Documento) -> Unit) {
    if (c.actuaciones.isEmpty()) item { EmptyText("Sin actuaciones registradas.") }
    items(c.actuaciones, key = { it.id }) { a ->
        Surface(
            shape = RoundedCornerShape(14.dp),
            color = Brand.Panel,
            border = androidx.compose.foundation.BorderStroke(1.dp, if (a.seen) Brand.Border else Brand.Accent),
        ) {
            Column(Modifier.fillMaxWidth().padding(14.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(fecha(a.fecha), color = Brand.Muted, style = MaterialTheme.typography.bodySmall)
                    if (!a.seen) Pill("nueva", Brand.Green, filled = true)
                    if (a.conDocumentos) Pill("con documentos")
                }
                Spacer(Modifier.height(4.dp))
                Text(a.nombre, style = MaterialTheme.typography.titleSmall)
                if (!a.anotacion.isNullOrBlank()) {
                    Spacer(Modifier.height(4.dp))
                    Text(a.anotacion, style = MaterialTheme.typography.bodyMedium, color = Brand.Text.copy(alpha = 0.85f))
                }
                if (a.docs.isNotEmpty()) {
                    Spacer(Modifier.height(8.dp))
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        a.docs.forEach { d -> DocChip(d, openDocument) }
                    }
                }
            }
        }
    }
}

@Composable
private fun DocChip(d: Documento, openDocument: (Documento) -> Unit) {
    AssistChip(
        onClick = { openDocument(d) },
        label = { Text(d.nombre, maxLines = 1) },
        leadingIcon = { Icon(Icons.Outlined.Description, null, Modifier.size(18.dp)) },
        colors = AssistChipDefaults.assistChipColors(labelColor = Brand.Text, leadingIconContentColor = Brand.Accent),
    )
}

private fun LazyListScope.documentos(c: CaseDetail, openDocument: (Documento) -> Unit) {
    if (c.documentos.isEmpty()) item { EmptyText("Este proceso no tiene documentos en la Rama Judicial.") }
    items(c.documentos, key = { it.id }) { d ->
        Surface(
            shape = RoundedCornerShape(14.dp),
            color = Brand.Panel,
            border = androidx.compose.foundation.BorderStroke(1.dp, Brand.Border),
            modifier = Modifier.fillMaxWidth().clickable { openDocument(d) },
        ) {
            Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.Description, null, tint = Brand.Accent)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(d.nombre, style = MaterialTheme.typography.titleSmall)
                    Text(
                        listOfNotNull(fecha(d.fechaCarga), d.tipo?.uppercase(), d.descripcion).joinToString(" · "),
                        color = Brand.Muted,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
        }
    }
}

private fun LazyListScope.partes(c: CaseDetail) {
    item {
        SectionCard(title = "Partes (${c.partes.size})") {
            if (c.partes.isEmpty()) EmptyText("Sin partes registradas.")
            c.partes.forEachIndexed { i, p ->
                if (i > 0) HorizontalDivider(color = Brand.Border)
                Column(Modifier.padding(vertical = 8.dp)) {
                    Text(p.rol, color = Brand.Muted, style = MaterialTheme.typography.bodySmall)
                    Text(p.nombre + (p.identificacion?.let { " · $it" } ?: ""))
                }
            }
        }
    }
}

private fun LazyListScope.grabaciones(c: CaseDetail) {
    if (c.grabaciones.isEmpty()) {
        item {
            EmptyText(
                "No se encontraron enlaces a grabaciones en las actuaciones de este proceso. " +
                    "(El juzgado suele pegar el enlace de la audiencia dentro de una actuación cuando la publica.)",
            )
        }
    }
    items(c.grabaciones) { g ->
        val context = LocalContext.current
        Surface(
            shape = RoundedCornerShape(14.dp),
            color = Brand.Panel,
            border = androidx.compose.foundation.BorderStroke(1.dp, Brand.Border),
            modifier = Modifier.fillMaxWidth().clickable {
                runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(g.url))) }
                    .onFailure { Toast.makeText(context, "No hay una app para abrir este enlace.", Toast.LENGTH_SHORT).show() }
            },
        ) {
            Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.Mic, null, tint = Brand.Accent)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(g.actuacion, style = MaterialTheme.typography.titleSmall)
                    Text("${fecha(g.fecha)} · ${g.url}", color = Brand.Muted, style = MaterialTheme.typography.bodySmall, maxLines = 2)
                }
            }
        }
    }
}

private fun LazyListScope.sincronizacion(c: CaseDetail) {
    if (c.syncLogs.isEmpty()) item { EmptyText("Aún no hay sincronizaciones registradas.") }
    items(c.syncLogs) { l ->
        val ok = l.resultado == "exito"
        Surface(
            shape = RoundedCornerShape(12.dp),
            color = Brand.Panel,
            border = androidx.compose.foundation.BorderStroke(1.dp, Brand.Border),
        ) {
            Column(Modifier.fillMaxWidth().padding(12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        if (ok) Icons.Outlined.CheckCircle else Icons.Outlined.Warning,
                        null,
                        tint = if (ok) Brand.Green else Brand.Amber,
                        modifier = Modifier.size(18.dp),
                    )
                    Spacer(Modifier.width(6.dp))
                    Text(l.operacion, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                    Text(fechaHora(l.inicio), color = Brand.Muted, style = MaterialTheme.typography.bodySmall)
                }
                Text(
                    listOfNotNull(
                        l.origen,
                        l.duracionMs?.let { "%.1f s".format(it / 1000.0) },
                        "${l.elementos} elemento(s)",
                    ).joinToString(" · "),
                    color = Brand.Muted,
                    style = MaterialTheme.typography.bodySmall,
                )
                if (l.error != null) Text(l.error, color = Brand.Red, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}
