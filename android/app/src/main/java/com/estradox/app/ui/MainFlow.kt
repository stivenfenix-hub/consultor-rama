package com.estradox.app.ui

import android.Manifest
import android.content.Context
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.Balance
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.estradox.app.notify.Notifier
import kotlinx.coroutines.launch

private data class Tab(val route: String, val label: String, val icon: androidx.compose.ui.graphics.vector.ImageVector)

private val TABS = listOf(
    Tab("dashboard", "Inicio", Icons.Outlined.Home),
    Tab("cases", "Procesos", Icons.Outlined.Balance),
    Tab("account", "Cuenta", Icons.Outlined.AccountCircle),
)

/** App con sesión iniciada: barra inferior + pantallas de la plataforma. */
@Composable
fun MainFlow() {
    val state = LocalAppState.current
    val nav = rememberNavController()

    // Perfil y estado de la suscripción al abrir la app.
    LaunchedEffect(Unit) { runCatching { state.refreshPerfil() }.onFailure { state.message(it) } }
    AskNotificationPermission()

    if (state.expired && state.perfil?.user?.isAdmin != true) {
        ExpiredScreen()
        return
    }

    // Enlace de una notificación: "/dashboard/procesos/<id>" abre el proceso.
    LaunchedEffect(state.pendingUrl) {
        val url = state.pendingUrl ?: return@LaunchedEffect
        state.pendingUrl = null
        val caseId = Regex("/procesos/([^/?#]+)").find(url)?.groupValues?.get(1)
        if (caseId != null) nav.navigate("case/$caseId") else nav.navigateTab("dashboard")
    }

    val backStack by nav.currentBackStackEntryAsState()
    val route = backStack?.destination?.route
    Scaffold(
        containerColor = Brand.Bg,
        bottomBar = {
            if (TABS.any { it.route == route }) {
                NavigationBar(containerColor = Brand.Panel) {
                    TABS.forEach { tab ->
                        NavigationBarItem(
                            selected = route == tab.route,
                            onClick = { nav.navigateTab(tab.route) },
                            icon = { Icon(tab.icon, contentDescription = null) },
                            label = { Text(tab.label) },
                            colors = NavigationBarItemDefaults.colors(
                                selectedIconColor = androidx.compose.ui.graphics.Color.White,
                                selectedTextColor = Brand.Text,
                                indicatorColor = Brand.Accent,
                                unselectedIconColor = Brand.Muted,
                                unselectedTextColor = Brand.Muted,
                            ),
                        )
                    }
                }
            }
        },
    ) { padding ->
        NavHost(nav, startDestination = "dashboard", modifier = Modifier.padding(padding)) {
            composable("dashboard") {
                DashboardScreen(
                    openCase = { nav.navigate("case/$it") },
                    openCases = { nav.navigateTab("cases") },
                )
            }
            composable("cases") { CasesScreen(openCase = { nav.navigate("case/$it") }) }
            composable("account") { AccountScreen() }
            composable("case/{id}", arguments = listOf(navArgument("id") { type = NavType.StringType })) { entry ->
                CaseDetailScreen(
                    caseId = entry.arguments!!.getString("id")!!,
                    onBack = { nav.popBackStack() },
                    openDocument = { doc -> nav.navigate(DocumentRoute.build(doc)) },
                )
            }
            composable(DocumentRoute.PATTERN, arguments = DocumentRoute.args) { entry ->
                DocumentScreen(DocumentRoute.parse(entry.arguments!!), onBack = { nav.popBackStack() })
            }
        }
    }
}

private fun NavHostController.navigateTab(route: String) {
    navigate(route) {
        popUpTo(graph.findStartDestination().id) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
}

/** Pide permiso de notificaciones una sola vez (Android 13+). */
@Composable
private fun AskNotificationPermission() {
    if (Build.VERSION.SDK_INT < 33) return
    val context = LocalContext.current
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
    LaunchedEffect(Unit) {
        val prefs = context.getSharedPreferences("ui", Context.MODE_PRIVATE)
        if (!Notifier.canNotify(context) && !prefs.getBoolean("askedNotif", false)) {
            prefs.edit().putBoolean("askedNotif", true).apply()
            launcher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
}

/**
 * Acceso vencido. Por las reglas de Google Play la app no vende ni enlaza a
 * pagos externos: solo informa y permite volver a verificar tras renovar.
 */
@Composable
private fun ExpiredScreen() {
    val state = LocalAppState.current
    val scope = rememberCoroutineScope()
    var checking by remember { mutableStateOf(false) }
    var msg by remember { mutableStateOf<String?>(null) }
    Column(
        Modifier.fillMaxSize().systemBarsPadding().padding(28.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Wordmark(26)
        Spacer(Modifier.height(24.dp))
        Text("Tu acceso venció", style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.height(10.dp))
        Text(
            "Tu periodo de prueba o tu plan terminó. Cuando renueves tu plan, vuelve aquí y toca \"Ya renové\" para seguir usando Estradox.",
            color = Brand.Muted,
            textAlign = TextAlign.Center,
        )
        Message(msg)
        Spacer(Modifier.height(24.dp))
        GradientButton(
            "Ya renové",
            onClick = {
                scope.launch {
                    checking = true
                    try {
                        state.refreshPerfil()
                        if (state.expired) msg = "Tu acceso sigue vencido."
                    } catch (e: Exception) {
                        msg = state.message(e)
                    }
                    checking = false
                }
            },
            modifier = Modifier.fillMaxWidth(),
            loading = checking,
        )
        Spacer(Modifier.height(10.dp))
        SecondaryButton("Cerrar sesión", { scope.launch { state.logout() } }, Modifier.fillMaxWidth())
    }
}
