package com.estradox.app.data

import kotlinx.serialization.Serializable

// Respuestas del API /api/mobile/* de Estradox. Las fechas llegan en ISO-8601 (UTC).

@Serializable
data class User(
    val id: String,
    val email: String,
    val name: String? = null,
    val firstName: String? = null,
    val lastName: String? = null,
    val role: String = "user",
    val whatsapp: String? = null,
) {
    val isAdmin get() = role == "admin"
    val displayName get() = name ?: listOfNotNull(firstName, lastName).joinToString(" ").ifBlank { email }
}

@Serializable
data class Suscripcion(
    /** "admin" | "prueba" | "activa" | "vencida" */
    val estado: String,
    val accesoHasta: String? = null,
    val diasRestantes: Int = 0,
) {
    val vencida get() = estado == "vencida"
}

@Serializable
data class Perfil(val user: User, val suscripcion: Suscripcion)

@Serializable
data class LoginResponse(val token: String, val user: User, val suscripcion: Suscripcion)

@Serializable
data class OkResponse(val ok: String? = null)

@Serializable
data class Slice(val label: String, val value: Int)

@Serializable
data class Buckets(val b0_6: Int, val b6_12: Int, val b12: Int, val sin: Int)

@Serializable
data class Stats(
    val totalProcesos: Int,
    val nuevosEsteMes: Int,
    val actuacionesEsteMes: Int,
    val sinVer: Int,
    val buckets: Buckets,
    val porClase: List<Slice>,
    val porDepartamento: List<Slice>,
)

@Serializable
data class RefreshAllStatus(val enCurso: Boolean, val disponibleEn: String? = null)

@Serializable
data class Reciente(
    val id: String,
    val radicado: String,
    val lastActuacionDate: String? = null,
    val ultimaActuacion: String? = null,
    val unseenCount: Int = 0,
)

@Serializable
data class Dashboard(val stats: Stats, val refreshAll: RefreshAllStatus, val recientes: List<Reciente>)

@Serializable
data class CaseSummary(
    val id: String,
    val radicado: String,
    val despacho: String? = null,
    val departamento: String? = null,
    val claseProceso: String? = null,
    val esPrivado: Boolean = false,
    val unseenCount: Int = 0,
    val lastActuacionDate: String? = null,
    val lastSyncedAt: String? = null,
    val lastError: String? = null,
)

@Serializable
data class CasesResponse(val cases: List<CaseSummary>)

@Serializable
data class AddCasesResponse(val ok: String, val agregados: Int, val fallidos: Int)

@Serializable
data class Dato(val label: String, val value: String)

@Serializable
data class Documento(
    val id: String,
    val nombre: String,
    val descripcion: String? = null,
    val tipo: String? = null,
    val fechaCarga: String? = null,
)

@Serializable
data class Actuacion(
    val id: String,
    val fecha: String? = null,
    val nombre: String,
    val anotacion: String? = null,
    val seen: Boolean,
    val conDocumentos: Boolean = false,
    val docs: List<Documento> = emptyList(),
)

@Serializable
data class Parte(val rol: String, val nombre: String, val identificacion: String? = null)

@Serializable
data class Grabacion(val fecha: String? = null, val actuacion: String, val url: String)

@Serializable
data class SyncLog(
    val inicio: String,
    val origen: String,
    val operacion: String,
    val resultado: String,
    val duracionMs: Int? = null,
    val elementos: Int = 0,
    val error: String? = null,
)

@Serializable
data class CaseDetail(
    val id: String,
    val radicado: String,
    val esPrivado: Boolean = false,
    val fechaProceso: String? = null,
    val lastSyncedAt: String? = null,
    val lastError: String? = null,
    val unseenCount: Int = 0,
    val proximaActualizacion: String? = null,
    val datos: List<Dato>,
    val actuaciones: List<Actuacion>,
    val documentos: List<Documento>,
    val partes: List<Parte>,
    val grabaciones: List<Grabacion>,
    val syncLogs: List<SyncLog>,
)

@Serializable
data class RefreshResponse(val ok: String, val nuevas: Int = 0)

@Serializable
data class Pago(val id: String, val amount: Int, val status: String, val meses: Int = 1, val fecha: String? = null)

@Serializable
data class SubscriptionResponse(val suscripcion: Suscripcion, val pagos: List<Pago>)

@Serializable
data class Notice(
    val id: Int,
    val title: String,
    val body: String,
    val url: String? = null,
    val tag: String? = null,
)

@Serializable
data class NoticesResponse(val notices: List<Notice>, val lastId: Int)

@Serializable
data class WhatsappResponse(val ok: String, val whatsapp: String)
