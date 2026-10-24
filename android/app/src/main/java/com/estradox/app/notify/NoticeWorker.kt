package com.estradox.app.notify

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.estradox.app.EstradoxApp
import com.estradox.app.data.ApiException
import java.util.concurrent.TimeUnit

/**
 * Revisa en segundo plano los avisos del servidor (actuaciones nuevas, fin de
 * "Actualizar todos", avisos del administrador) y los muestra como
 * notificaciones de Android. La revisión diaria de la Rama la hace el
 * servidor; aquí solo se consulta si hay algo nuevo.
 */
class NoticeWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val app = applicationContext as EstradoxApp
        if (app.session.token == null) return Result.success()
        return try {
            checkNow(app)
            Result.success()
        } catch (e: ApiException) {
            if (e.status == 401) Result.success() else Result.retry()
        }
    }

    companion object {
        private const val NAME = "estradox-notices"

        /** Consulta los avisos nuevos y los muestra. La primera vez solo marca hasta dónde va. */
        suspend fun checkNow(app: EstradoxApp) {
            val after = app.session.lastNoticeId
            val res = app.api.notices(after)
            if (after != null) res.notices.forEach { Notifier.show(app, it) }
            app.session.lastNoticeId = res.lastId
        }

        fun schedule(context: Context) {
            val req = PeriodicWorkRequestBuilder<NoticeWorker>(30, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.KEEP, req)
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(NAME)
        }
    }
}
