package com.estradox.app.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

// Colores de la plataforma web (SiteSetting + globals.css).
object Brand {
    val Accent = Color(0xFF8B3DFF)
    val Accent2 = Color(0xFF4B23E6)
    val Bg = Color(0xFF0A0820)
    val Panel = Color(0xFF151140)
    val Panel2 = Color(0xFF1C1752)
    val Border = Color(0xFF322A74)
    val Text = Color(0xFFECEBFB)
    val Muted = Color(0xFFA39CD8)
    val Green = Color(0xFF2FC26B)
    val Red = Color(0xFFFF5C72)
    val Amber = Color(0xFFF0B429)
    val Gradient = Brush.linearGradient(listOf(Accent, Accent2))

    /** Paleta de los gráficos de dona (por clase / departamento). */
    val Chart = listOf(
        Color(0xFF8B3DFF), Color(0xFF2FC26B), Color(0xFFF0B429), Color(0xFF38BDF8),
        Color(0xFFFF5C72), Color(0xFFC084FC), Color(0xFF5EEAD4), Color(0xFF7C7FA8),
    )
}

private val colors = darkColorScheme(
    primary = Brand.Accent,
    onPrimary = Color.White,
    primaryContainer = Brand.Accent2,
    onPrimaryContainer = Color.White,
    secondary = Brand.Muted,
    onSecondary = Brand.Bg,
    secondaryContainer = Brand.Panel2,
    onSecondaryContainer = Brand.Text,
    background = Brand.Bg,
    onBackground = Brand.Text,
    surface = Brand.Bg,
    onSurface = Brand.Text,
    surfaceVariant = Brand.Panel,
    onSurfaceVariant = Brand.Muted,
    surfaceContainerLowest = Brand.Bg,
    surfaceContainerLow = Brand.Panel,
    surfaceContainer = Brand.Panel,
    surfaceContainerHigh = Brand.Panel2,
    surfaceContainerHighest = Brand.Panel2,
    outline = Brand.Border,
    outlineVariant = Brand.Border,
    error = Brand.Red,
    onError = Color.White,
)

private val base = Typography()
private val typography = base.copy(
    headlineSmall = base.headlineSmall.copy(fontWeight = FontWeight.Bold),
    titleLarge = base.titleLarge.copy(fontWeight = FontWeight.Bold),
    titleMedium = base.titleMedium.copy(fontWeight = FontWeight.SemiBold),
)

val Mono = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 15.sp, letterSpacing = 0.3.sp)

@Composable
fun EstradoxTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = colors, typography = typography, content = content)
}
