package com.estradox.app.notify

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.estradox.app.MainActivity
import com.estradox.app.R
import com.estradox.app.data.Notice

/** Notificaciones nativas de Android para los avisos de Estradox. */
object Notifier {
    const val CHANNEL_ACTUACIONES = "actuaciones"
    const val CHANNEL_GENERAL = "general"
    const val EXTRA_URL = "estradox.url"

    fun createChannels(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ACTUACIONES,
                context.getString(R.string.channel_actuaciones),
                NotificationManager.IMPORTANCE_HIGH,
            ).apply { description = context.getString(R.string.channel_actuaciones_desc) },
        )
        nm.createNotificationChannel(
            NotificationChannel(
                CHANNEL_GENERAL,
                context.getString(R.string.channel_general),
                NotificationManager.IMPORTANCE_DEFAULT,
            ).apply { description = context.getString(R.string.channel_general_desc) },
        )
    }

    fun canNotify(context: Context) =
        Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED

    fun show(context: Context, notice: Notice) {
        if (!canNotify(context)) return
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(EXTRA_URL, notice.url)
        }
        val pending = PendingIntent.getActivity(
            context,
            notice.id,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val channel = if (notice.tag == "actuaciones") CHANNEL_ACTUACIONES else CHANNEL_GENERAL
        val n = NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_stat_estradox)
            .setColor(0xFF8B3DFF.toInt())
            .setContentTitle(notice.title)
            .setContentText(notice.body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(notice.body))
            .setContentIntent(pending)
            .setAutoCancel(true)
            .build()
        try {
            NotificationManagerCompat.from(context).notify(notice.id, n)
        } catch (_: SecurityException) {
            // El usuario quitó el permiso de notificaciones.
        }
    }
}
