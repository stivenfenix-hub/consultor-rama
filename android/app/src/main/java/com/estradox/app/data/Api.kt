package com.estradox.app.data

import android.os.Build
import com.estradox.app.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit

/** Error del API: `status` 0 = sin conexión. 401 = sesión vencida, 402 = acceso vencido. */
class ApiException(val status: Int, message: String, val field: String? = null) : Exception(message)

/**
 * Cliente del API móvil de Estradox: conecta directo al servidor de la
 * plataforma (sin navegador) con el token Bearer de la sesión.
 */
class Api(private val session: Session) {
    private val base = BuildConfig.API_BASE.trimEnd('/') + "/api/mobile"
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }
    private val jsonType = "application/json; charset=utf-8".toMediaType()

    private val client = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()

    // La Rama Judicial es lenta: agregar o actualizar procesos puede tardar minutos.
    private val slowClient = client.newBuilder().readTimeout(5, TimeUnit.MINUTES).build()

    // ---------- Cuenta ----------
    suspend fun login(email: String, password: String): LoginResponse {
        val device = "${Build.MANUFACTURER} ${Build.MODEL}".trim()
        return post("/auth/login", buildJsonObject {
            put("email", email); put("password", password); put("device", device)
        })
    }

    suspend fun register(firstName: String, lastName: String, email: String, whatsapp: String, password: String): OkResponse =
        post("/auth/register", buildJsonObject {
            put("firstName", firstName); put("lastName", lastName); put("email", email)
            put("whatsapp", whatsapp); put("password", password)
        })

    suspend fun forgot(email: String): OkResponse = post("/auth/forgot", buildJsonObject { put("email", email) })
    suspend fun resendVerification(email: String): OkResponse = post("/auth/resend", buildJsonObject { put("email", email) })
    suspend fun logout() { runCatching { post<OkResponse>("/auth/logout", JsonObject(emptyMap())) } }

    suspend fun me(): Perfil = get("/me")
    suspend fun setWhatsapp(whatsapp: String): WhatsappResponse = send("PUT", "/me/whatsapp", buildJsonObject { put("whatsapp", whatsapp) })
    suspend fun changePassword(current: String, password: String): OkResponse =
        post("/me/password", buildJsonObject { put("current", current); put("password", password) })
    suspend fun deleteAccount(password: String): OkResponse = send("DELETE", "/me", buildJsonObject { put("password", password) })
    suspend fun subscription(): SubscriptionResponse = get("/subscription")

    // ---------- Procesos ----------
    suspend fun dashboard(): Dashboard = get("/dashboard")
    suspend fun cases(): CasesResponse = get("/cases")
    suspend fun addCases(radicados: String): AddCasesResponse =
        post("/cases", buildJsonObject { put("radicados", radicados) }, slowClient)
    suspend fun case(id: String): CaseDetail = get("/cases/$id")
    suspend fun deleteCase(id: String): OkResponse = send("DELETE", "/cases/$id", null)
    suspend fun refreshCase(id: String): RefreshResponse = post("/cases/$id/refresh", JsonObject(emptyMap()), slowClient)
    suspend fun markSeen(id: String) { post<OkResponse>("/cases/$id/seen", JsonObject(emptyMap())) }
    suspend fun refreshAll(): OkResponse = post("/refresh-all", JsonObject(emptyMap()))
    suspend fun notices(after: Int?): NoticesResponse = get(if (after == null) "/notices" else "/notices?after=$after")

    /** Descarga un documento de la Rama (vía el servidor) al archivo indicado. */
    suspend fun download(docId: String, dest: File) = withContext(Dispatchers.IO) {
        val req = request("/documents/$docId").get().build()
        slowClient.newCall(req).executeSafely().use { res ->
            if (!res.isSuccessful) throw error(res)
            dest.parentFile?.mkdirs()
            res.body!!.byteStream().use { input -> dest.outputStream().use { input.copyTo(it) } }
        }
    }

    // ---------- HTTP ----------
    private fun request(path: String) = Request.Builder().url(base + path).apply {
        session.token?.let { header("Authorization", "Bearer $it") }
        header("Accept", "application/json")
        header("User-Agent", "EstradoxAndroid/${BuildConfig.VERSION_NAME}")
    }

    private suspend inline fun <reified T> get(path: String): T = call(request(path).get().build(), client)

    private suspend inline fun <reified T> post(path: String, body: JsonObject, http: OkHttpClient = client): T =
        call(request(path).post(body.toString().toRequestBody(jsonType)).build(), http)

    private suspend inline fun <reified T> send(method: String, path: String, body: JsonObject?): T =
        call(request(path).method(method, body?.toString()?.toRequestBody(jsonType)).build(), client)

    private suspend inline fun <reified T> call(req: Request, http: OkHttpClient): T = withContext(Dispatchers.IO) {
        http.newCall(req).executeSafely().use { res ->
            val text = res.body?.string().orEmpty()
            if (!res.isSuccessful) throw error(res, text)
            try {
                json.decodeFromString<T>(text)
            } catch (e: Exception) {
                throw ApiException(res.code, "Respuesta inesperada del servidor.")
            }
        }
    }

    private fun okhttp3.Call.executeSafely(): Response = try {
        execute()
    } catch (e: IOException) {
        throw ApiException(0, "Sin conexión. Revisa tu internet e intenta de nuevo.")
    }

    private fun error(res: Response, text: String = runCatching { res.body?.string() }.getOrNull().orEmpty()): ApiException {
        val obj = runCatching { json.parseToJsonElement(text).jsonObject }.getOrNull()
        val msg = (obj?.get("error") as? JsonPrimitive)?.content
            ?: when (res.code) {
                401 -> "Tu sesión expiró. Vuelve a iniciar sesión."
                in 500..599 -> "El servidor no respondió. Intenta de nuevo en un momento."
                else -> "No se pudo completar la acción (${res.code})."
            }
        val field = obj?.get("field")?.jsonPrimitive?.content ?: obj?.get("needsVerify")?.let { "verify" }
        return ApiException(res.code, msg, field)
    }
}
