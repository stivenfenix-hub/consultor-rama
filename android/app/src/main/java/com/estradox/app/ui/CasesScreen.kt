package com.estradox.app.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.estradox.app.data.CaseSummary
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CasesScreen(openCase: (String) -> Unit) {
    val state = LocalAppState.current
    val loader = rememberLoader { state.api.cases().cases }
    var query by rememberSaveable { mutableStateOf("") }
    var adding by rememberSaveable { mutableStateOf(false) }

    Box(Modifier.fillMaxSize()) {
        PullToRefreshBox(
            isRefreshing = loader.loading && loader.data != null,
            onRefresh = loader::reload,
            modifier = Modifier.fillMaxSize(),
        ) {
            val cases = loader.data
            when {
                cases != null -> {
                    val q = query.trim().lowercase()
                    val digits = q.filter(Char::isDigit)
                    val visibles = if (q.isEmpty()) cases else cases.filter {
                        (digits.isNotEmpty() && it.radicado.contains(digits)) ||
                            it.despacho.orEmpty().lowercase().contains(q) ||
                            it.departamento.orEmpty().lowercase().contains(q) ||
                            it.claseProceso.orEmpty().lowercase().contains(q)
                    }
                    LazyColumn(
                        Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 96.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        item {
                            Text("Procesos", style = MaterialTheme.typography.headlineSmall)
                            Spacer(Modifier.height(10.dp))
                            OutlinedTextField(
                                value = query,
                                onValueChange = { query = it },
                                placeholder = { Text("Buscar por radicado, despacho o clase") },
                                leadingIcon = { Icon(Icons.Outlined.Search, null) },
                                singleLine = true,
                                shape = RoundedCornerShape(12.dp),
                                modifier = Modifier.fillMaxWidth(),
                            )
                            Spacer(Modifier.height(4.dp))
                            Text("${visibles.size} proceso(s)", color = Brand.Muted, style = MaterialTheme.typography.bodySmall)
                        }
                        if (cases.isEmpty()) {
                            item { EmptyText("Aún no sigues ningún proceso. Agrega uno con su radicado de 23 dígitos.") }
                        }
                        items(visibles, key = { it.id }) { c -> CaseRow(c) { openCase(c.id) } }
                    }
                }
                loader.error != null -> ErrorBox(loader.error!!, loader::reload)
                else -> LoadingBox()
            }
        }
        ExtendedFloatingActionButton(
            onClick = { adding = true },
            icon = { Icon(Icons.Outlined.Add, null) },
            text = { Text("Agregar proceso") },
            containerColor = Brand.Accent,
            contentColor = Color.White,
            modifier = Modifier.align(Alignment.BottomEnd).padding(16.dp),
        )
    }

    if (adding) {
        AddCaseDialog(onDismiss = { adding = false }, onAdded = { adding = false; loader.reload() })
    }
}

@Composable
private fun CaseRow(c: CaseSummary, onClick: () -> Unit) {
    Surface(
        shape = RoundedCornerShape(14.dp),
        color = Brand.Panel,
        border = androidx.compose.foundation.BorderStroke(1.dp, if (c.unseenCount > 0) Brand.Accent else Brand.Border),
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
    ) {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(radicadoLegible(c.radicado), style = Mono, modifier = Modifier.weight(1f))
                if (c.unseenCount > 0) Pill("${c.unseenCount} nuevas", Brand.Green, filled = true)
                if (c.esPrivado) {
                    Spacer(Modifier.width(6.dp))
                    Pill("privado")
                }
            }
            Spacer(Modifier.height(4.dp))
            Text(
                listOfNotNull(c.despacho ?: "Despacho no disponible", c.departamento).joinToString(" · "),
                color = Brand.Muted,
                style = MaterialTheme.typography.bodySmall,
            )
            Text(
                "Últ. actuación: ${fecha(c.lastActuacionDate)}",
                color = Brand.Muted,
                style = MaterialTheme.typography.bodySmall,
            )
            if (c.lastError != null) {
                Text("Error última sync: ${c.lastError}", color = Brand.Red, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

@Composable
private fun AddCaseDialog(onDismiss: () -> Unit, onAdded: () -> Unit) {
    val state = LocalAppState.current
    val scope = rememberCoroutineScope()
    var text by rememberSaveable { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    // Misma regla que el servidor: cada radicado (separado por coma, espacio o ;) con 23 dígitos.
    val count = text.split(Regex("[\\s,;]+")).map { it.filter(Char::isDigit) }.filter { it.length == 23 }.toSet().size

    AlertDialog(
        onDismissRequest = { if (!loading) onDismiss() },
        title = { Text("Agregar proceso") },
        text = {
            Column {
                Text(
                    "Escribe uno o varios radicados de 23 dígitos, separados por coma o espacio.",
                    color = Brand.Muted,
                    style = MaterialTheme.typography.bodySmall,
                )
                Spacer(Modifier.height(10.dp))
                OutlinedTextField(
                    value = text,
                    onValueChange = { text = it },
                    placeholder = { Text("05001310300120200012300") },
                    minLines = 2,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !loading,
                )
                if (loading) {
                    Text(
                        "Consultando la Rama Judicial… puede tardar un poco.",
                        color = Brand.Muted,
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.padding(top = 8.dp),
                    )
                }
                Message(error)
            }
        },
        confirmButton = {
            GradientButton(
                if (count > 1) "Agregar $count" else "Agregar",
                onClick = {
                    scope.launch {
                        loading = true; error = null
                        try {
                            state.api.addCases(text)
                            onAdded()
                        } catch (e: Exception) {
                            error = state.message(e)
                        }
                        loading = false
                    }
                },
                enabled = count > 0,
                loading = loading,
            )
        },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !loading) { Text("Cancelar") } },
    )
}
