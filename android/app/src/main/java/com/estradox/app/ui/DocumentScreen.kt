package com.estradox.app.ui

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color as AndroidColor
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.Bundle
import android.os.ParcelFileDescriptor
import android.webkit.MimeTypeMap
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import androidx.navigation.NavType
import androidx.navigation.navArgument
import com.estradox.app.data.Documento
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File

/** Ruta del visor: document/{id}?nombre=..&tipo=.. */
object DocumentRoute {
    const val PATTERN = "document/{id}?nombre={nombre}&tipo={tipo}"
    val args = listOf(
        navArgument("id") { type = NavType.StringType },
        navArgument("nombre") { type = NavType.StringType; defaultValue = "Documento" },
        navArgument("tipo") { type = NavType.StringType; nullable = true; defaultValue = null },
    )

    fun build(d: Documento) =
        "document/${Uri.encode(d.id)}?nombre=${Uri.encode(d.nombre)}" + (d.tipo?.let { "&tipo=${Uri.encode(it)}" } ?: "")

    fun parse(b: Bundle) = Documento(
        id = b.getString("id")!!,
        nombre = b.getString("nombre") ?: "Documento",
        tipo = b.getString("tipo"),
    )
}

private sealed interface DocState {
    data object Loading : DocState
    data class Ready(val file: File) : DocState
    data class Failed(val message: String) : DocState
}

/**
 * Visor nativo de documentos: descarga el archivo del servidor de Estradox y
 * muestra los PDF dentro de la app (PdfRenderer). Permite guardarlo,
 * compartirlo o abrirlo con otra app.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DocumentScreen(doc: Documento, onBack: () -> Unit) {
    val state = LocalAppState.current
    val context = LocalContext.current
    val ext = (doc.tipo?.lowercase()?.takeIf { it.matches(Regex("[a-z0-9]{1,5}")) }) ?: "pdf"
    val mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "application/octet-stream"
    val fileName = doc.nombre.replace(Regex("[^\\w.\\- ]+"), "_").take(80) + ".$ext"
    var reloadKey by remember { mutableStateOf(0) }

    val docState by produceState<DocState>(DocState.Loading, doc.id, reloadKey) {
        value = DocState.Loading
        val file = File(context.cacheDir, "docs/${doc.id.replace(Regex("[^\\w-]"), "_")}.$ext")
        value = try {
            if (!file.exists() || file.length() == 0L) {
                val tmp = File(file.path + ".part")
                state.api.download(doc.id, tmp)
                tmp.renameTo(file)
            }
            DocState.Ready(file)
        } catch (e: Exception) {
            DocState.Failed(state.message(e))
        }
    }

    val saveLauncher = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument(mime)) { uri ->
        val f = (docState as? DocState.Ready)?.file ?: return@rememberLauncherForActivityResult
        if (uri != null) {
            val ok = runCatching {
                context.contentResolver.openOutputStream(uri)!!.use { out -> f.inputStream().use { it.copyTo(out) } }
            }.isSuccess
            Toast.makeText(context, if (ok) "Documento guardado" else "No se pudo guardar", Toast.LENGTH_SHORT).show()
        }
    }

    Scaffold(
        containerColor = Brand.Bg,
        contentWindowInsets = WindowInsets(0),
        topBar = {
            TopAppBar(
                windowInsets = WindowInsets(0),
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Brand.Bg),
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Volver") } },
                title = { Text(doc.nombre, maxLines = 1, style = MaterialTheme.typography.titleMedium) },
                actions = {
                    val file = (docState as? DocState.Ready)?.file
                    if (file != null) {
                        IconButton(onClick = { saveLauncher.launch(fileName) }) { Icon(Icons.Outlined.Download, "Guardar") }
                        IconButton(onClick = { share(context, file, mime, fileName) }) { Icon(Icons.Outlined.Share, "Compartir") }
                        IconButton(onClick = { openWith(context, file, mime) }) {
                            Icon(Icons.AutoMirrored.Outlined.OpenInNew, "Abrir con otra app")
                        }
                    }
                },
            )
        },
    ) { padding ->
        Box(Modifier.padding(padding).fillMaxSize()) {
            when (val s = docState) {
                DocState.Loading -> Column(
                    Modifier.fillMaxSize(),
                    verticalArrangement = Arrangement.Center,
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    LoadingBox(Modifier.size(64.dp))
                    Spacer(Modifier.height(12.dp))
                    Text("Descargando de la Rama Judicial…", color = Brand.Muted)
                }
                is DocState.Failed -> ErrorBox(s.message, onRetry = { reloadKey++ })
                is DocState.Ready ->
                    if (ext == "pdf") PdfView(s.file) else NotPreviewable(onOpen = { openWith(context, s.file, mime) })
            }
        }
    }
}

@Composable
private fun NotPreviewable(onOpen: () -> Unit) {
    Column(
        Modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(Icons.Outlined.Description, null, tint = Brand.Accent, modifier = Modifier.size(56.dp))
        Spacer(Modifier.height(12.dp))
        Text(
            "Este tipo de archivo no se puede ver dentro de la app. Ábrelo con otra aplicación o guárdalo en tu teléfono.",
            color = Brand.Muted,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(16.dp))
        GradientButton("Abrir con…", onOpen)
    }
}

/** Páginas del PDF renderizadas como imágenes; pellizca para hacer zoom. */
@Composable
private fun PdfView(file: File) {
    val renderer = remember(file) {
        runCatching { PdfRenderer(ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)) }.getOrNull()
    }
    DisposableEffect(renderer) { onDispose { renderer?.close() } }
    if (renderer == null) {
        ErrorBox("No se pudo abrir el PDF. Prueba abrirlo con otra app.", onRetry = {})
        return
    }
    val lock = remember { Mutex() }
    var scale by remember { mutableFloatStateOf(1f) }
    var offsetX by remember { mutableFloatStateOf(0f) }

    BoxWithConstraints(
        Modifier
            .fillMaxSize()
            .clipToBounds()
            .background(Color(0xFF1A1740))
            .pointerInput(Unit) {
                awaitEachGesture {
                    awaitFirstDown(requireUnconsumed = false)
                    do {
                        val event = awaitPointerEvent()
                        val maxX = size.width * (scale - 1f) / 2f
                        if (event.changes.size >= 2) {
                            scale = (scale * event.calculateZoom()).coerceIn(1f, 4f)
                            offsetX = (offsetX + event.calculatePan().x).coerceIn(-maxX, maxX)
                            event.changes.forEach { it.consume() }
                        } else if (scale > 1f) {
                            // Con zoom, un dedo mueve la página a los lados; el desplazamiento vertical sigue siendo de la lista.
                            offsetX = (offsetX + event.calculatePan().x).coerceIn(-maxX, maxX)
                        }
                    } while (event.changes.any { it.pressed })
                }
            },
    ) {
        // Algo más de resolución que la pantalla para que el zoom se lea bien, con tope por memoria.
        val widthPx = (with(LocalDensity.current) { maxWidth.toPx() } * 1.5f).toInt().coerceAtMost(1600)
        LazyColumn(
            Modifier
                .fillMaxSize()
                .graphicsLayer {
                    scaleX = scale
                    scaleY = scale
                    translationX = offsetX
                },
            contentPadding = PaddingValues(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            items(renderer.pageCount) { i -> PdfPage(renderer, i, lock, widthPx) }
        }
    }
}

@Composable
private fun PdfPage(renderer: PdfRenderer, index: Int, lock: Mutex, widthPx: Int) {
    var ratio by remember { mutableFloatStateOf(0.7727f) } // carta vertical mientras carga
    val bitmap by produceState<Bitmap?>(null, index, widthPx) {
        value = withContext(Dispatchers.IO) {
            lock.withLock {
                renderer.openPage(index).use { page ->
                    ratio = page.width.toFloat() / page.height
                    val w = widthPx.coerceAtLeast(1)
                    val h = (w / ratio).toInt().coerceAtLeast(1)
                    Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888).also {
                        it.eraseColor(AndroidColor.WHITE)
                        page.render(it, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                    }
                }
            }
        }
    }
    val b = bitmap
    if (b == null) {
        Box(Modifier.fillMaxWidth().aspectRatio(ratio).background(Color.White.copy(alpha = 0.08f)))
    } else {
        Image(
            b.asImageBitmap(),
            contentDescription = "Página ${index + 1}",
            contentScale = ContentScale.FillWidth,
            modifier = Modifier.fillMaxWidth().aspectRatio(ratio),
        )
    }
}

private fun uriFor(context: Context, file: File): Uri =
    FileProvider.getUriForFile(context, "${context.packageName}.files", file)

private fun share(context: Context, file: File, mime: String, name: String) {
    val intent = Intent(Intent.ACTION_SEND).apply {
        type = mime
        putExtra(Intent.EXTRA_STREAM, uriFor(context, file))
        putExtra(Intent.EXTRA_SUBJECT, name)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    context.startActivity(Intent.createChooser(intent, "Compartir documento"))
}

private fun openWith(context: Context, file: File, mime: String) {
    val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uriFor(context, file), mime)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    runCatching { context.startActivity(Intent.createChooser(intent, "Abrir con")) }
        .onFailure { Toast.makeText(context, "No hay una app para abrir este archivo.", Toast.LENGTH_SHORT).show() }
}
