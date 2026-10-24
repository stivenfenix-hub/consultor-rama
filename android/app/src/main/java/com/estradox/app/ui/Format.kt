package com.estradox.app.ui

import java.text.NumberFormat
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

// Fechas y valores con el mismo formato que la web (es-CO, hora de Colombia).
private val CO = Locale.forLanguageTag("es-CO")
private val TZ = ZoneId.of("America/Bogota")
private val corta = DateTimeFormatter.ofPattern("d MMM yyyy", CO).withZone(TZ)
private val larga = DateTimeFormatter.ofPattern("d 'de' MMMM 'de' yyyy", CO).withZone(TZ)
private val conHora = DateTimeFormatter.ofPattern("d MMM yyyy, h:mm a", CO).withZone(TZ)

private fun parse(iso: String?): Instant? = iso?.let { runCatching { Instant.parse(it) }.getOrNull() }

fun fecha(iso: String?): String = parse(iso)?.let { corta.format(it) } ?: "—"
fun fechaLarga(iso: String?): String = parse(iso)?.let { larga.format(it) } ?: "—"
fun fechaHora(iso: String?): String = parse(iso)?.let { conHora.format(it) } ?: "—"

fun pesos(n: Int): String = "$" + NumberFormat.getIntegerInstance(CO).format(n)

/** Radicado de 23 dígitos agrupado para leerlo mejor: 05001 31 03 001 2020 00123 00 */
fun radicadoLegible(r: String): String =
    if (r.length == 23 && r.all(Char::isDigit)) {
        listOf(r.substring(0, 5), r.substring(5, 7), r.substring(7, 9), r.substring(9, 12),
            r.substring(12, 16), r.substring(16, 21), r.substring(21)).joinToString(" ")
    } else r
