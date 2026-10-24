package com.estradox.app.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.foundation.clickable
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Marca "ESTRADOX" con la X en el color de acento (como el logo). */
@Composable
fun Wordmark(fontSize: Int = 30) {
    Text(
        buildAnnotatedString {
            append("ESTRADO")
            withStyle(SpanStyle(color = Brand.Accent)) { append("X") }
        },
        fontSize = fontSize.sp,
        fontWeight = FontWeight.Black,
        letterSpacing = 1.sp,
        color = Brand.Text,
    )
}

@Composable
fun SectionCard(
    modifier: Modifier = Modifier,
    title: String? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        color = Brand.Panel,
        border = androidx.compose.foundation.BorderStroke(1.dp, Brand.Border),
    ) {
        Column(Modifier.padding(16.dp)) {
            if (title != null) {
                Text(title, style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(10.dp))
            }
            content()
        }
    }
}

@Composable
fun StatTile(label: String, value: Int, modifier: Modifier = Modifier, accent: Color? = null) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(16.dp),
        color = Brand.Panel,
        border = androidx.compose.foundation.BorderStroke(1.dp, Brand.Border),
    ) {
        Column(Modifier.padding(14.dp)) {
            Text(label, style = MaterialTheme.typography.bodySmall, color = Brand.Muted, maxLines = 2)
            Spacer(Modifier.height(6.dp))
            Text(
                value.toString(),
                fontSize = 28.sp,
                fontWeight = FontWeight.Bold,
                color = accent ?: Brand.Text,
            )
        }
    }
}

@Composable
fun Pill(text: String, color: Color = Brand.Muted, filled: Boolean = false) {
    Box(
        Modifier
            .clip(RoundedCornerShape(50))
            .then(
                if (filled) Modifier.background(color.copy(alpha = 0.18f))
                else Modifier.border(1.dp, Brand.Border, RoundedCornerShape(50)),
            )
            .padding(horizontal = 8.dp, vertical = 2.dp),
    ) {
        Text(text, fontSize = 11.sp, color = color, fontWeight = FontWeight.SemiBold)
    }
}

/** Botón principal con el degradado de la marca. */
@Composable
fun GradientButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    loading: Boolean = false,
) {
    Box(
        modifier
            .height(50.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(if (enabled) Brand.Gradient else SolidColor(Brand.Border))
            .clickable(enabled = enabled && !loading, role = Role.Button, onClick = onClick)
            .padding(horizontal = 20.dp),
        contentAlignment = Alignment.Center,
    ) {
        if (loading) {
            CircularProgressIndicator(Modifier.size(22.dp), color = Color.White, strokeWidth = 2.dp)
        } else {
            Text(text, color = if (enabled) Color.White else Brand.Muted, fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
fun SecondaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    OutlinedButton(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier,
        shape = RoundedCornerShape(12.dp),
        border = androidx.compose.foundation.BorderStroke(1.dp, Brand.Border),
    ) { Text(text, color = Brand.Text) }
}

@Composable
fun FormField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    keyboardType: KeyboardType = KeyboardType.Text,
    password: Boolean = false,
    isError: Boolean = false,
    placeholder: String? = null,
    singleLine: Boolean = true,
    minLines: Int = 1,
) {
    var visible by remember { mutableStateOf(false) }
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(label) },
        placeholder = placeholder?.let { { Text(it) } },
        modifier = modifier.fillMaxWidth(),
        singleLine = singleLine,
        minLines = minLines,
        isError = isError,
        shape = RoundedCornerShape(12.dp),
        keyboardOptions = KeyboardOptions(keyboardType = if (password) KeyboardType.Password else keyboardType),
        visualTransformation = if (password && !visible) PasswordVisualTransformation() else VisualTransformation.None,
        trailingIcon = if (password) {
            {
                IconButton(onClick = { visible = !visible }) {
                    Icon(
                        if (visible) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility,
                        contentDescription = if (visible) "Ocultar contraseña" else "Mostrar contraseña",
                    )
                }
            }
        } else null,
    )
}

@Composable
fun Message(text: String?, ok: Boolean = false) {
    if (text == null) return
    Text(
        text,
        color = if (ok) Brand.Green else Brand.Red,
        style = MaterialTheme.typography.bodyMedium,
        modifier = Modifier.padding(top = 8.dp),
    )
}

@Composable
fun LoadingBox(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(color = Brand.Accent)
    }
}

@Composable
fun ErrorBox(message: String, onRetry: () -> Unit, modifier: Modifier = Modifier) {
    Column(
        modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(message, textAlign = TextAlign.Center, color = Brand.Muted)
        Spacer(Modifier.height(16.dp))
        SecondaryButton("Reintentar", onRetry)
    }
}

@Composable
fun EmptyText(text: String) {
    Text(text, color = Brand.Muted, style = MaterialTheme.typography.bodyMedium)
}

/** Dona con leyenda (procesos por clase / por departamento). */
@Composable
fun Donut(data: List<com.estradox.app.data.Slice>) {
    if (data.isEmpty()) {
        EmptyText("Sin datos aún.")
        return
    }
    // Las 7 más grandes y el resto agrupado en "Otros", igual de legible en pantallas pequeñas.
    val top = data.take(7).toMutableList()
    if (data.size > 7) top += com.estradox.app.data.Slice("Otros", data.drop(7).sumOf { it.value })
    val total = top.sumOf { it.value }.coerceAtLeast(1)
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(120.dp), contentAlignment = Alignment.Center) {
            Canvas(Modifier.size(120.dp)) {
                val stroke = 22.dp.toPx()
                var start = -90f
                top.forEachIndexed { i, s ->
                    val sweep = 360f * s.value / total
                    drawArc(
                        color = Brand.Chart[i % Brand.Chart.size],
                        startAngle = start,
                        sweepAngle = (sweep - 1.5f).coerceAtLeast(0.5f),
                        useCenter = false,
                        topLeft = Offset(stroke / 2, stroke / 2),
                        size = Size(size.width - stroke, size.height - stroke),
                        style = Stroke(stroke),
                    )
                    start += sweep
                }
            }
            Text(total.toString(), fontWeight = FontWeight.Bold, fontSize = 20.sp)
        }
        Spacer(Modifier.width(16.dp))
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            top.forEachIndexed { i, s ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(10.dp).clip(RoundedCornerShape(3.dp)).background(Brand.Chart[i % Brand.Chart.size]))
                    Spacer(Modifier.width(6.dp))
                    Text(
                        "${s.label} · ${s.value}",
                        style = MaterialTheme.typography.bodySmall,
                        maxLines = 1,
                        overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }
}

/** Barra apilada con la antigüedad de la última actuación. */
@Composable
fun BucketBar(items: List<Triple<String, Int, Color>>) {
    val total = items.sumOf { it.second }
    if (total == 0) {
        EmptyText("Sin procesos aún.")
        return
    }
    Row(Modifier.fillMaxWidth().height(14.dp).clip(RoundedCornerShape(7.dp))) {
        items.filter { it.second > 0 }.forEach { (_, v, c) ->
            Box(Modifier.weight(v.toFloat()).fillMaxSize().background(c))
        }
    }
    Spacer(Modifier.height(12.dp))
    items.forEach { (label, v, c) ->
        Row(Modifier.padding(vertical = 3.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(10.dp).clip(RoundedCornerShape(3.dp)).background(c))
            Spacer(Modifier.width(8.dp))
            Text(label, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
            Text("$v", fontWeight = FontWeight.SemiBold)
        }
    }
}
