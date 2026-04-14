package com.myClaudia.desktop

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

object NotificationRenderer {
  private const val TAG = "NotificationRenderer"
  private const val CHANNEL_ID = "ntfy_alerts"
  private const val CHANNEL_NAME = "Ntfy Alerts"
  private const val CHANNEL_DESCRIPTION = "Push notifications forwarded by ntfy-bridge"

  fun post(context: Context, intent: Intent, source: String) {
    ensureChannel(context)

    val title = intent.getStringExtra("title")?.take(120)?.ifBlank { "MyClaudia" } ?: "MyClaudia"
    val body = intent.getStringExtra("body")?.take(500) ?: ""
    val tags = intent.getStringExtra("tags") ?: ""
    val messageId = intent.getStringExtra("message_id") ?: ""
    val topic = intent.getStringExtra("topic") ?: ""
    val openPayload = intent.getStringExtra("open_payload") ?: ""

    val launchIntent = context.packageManager
      .getLaunchIntentForPackage(context.packageName)
      ?.apply {
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        putExtra("from_notification", true)
        putExtra("tags", tags)
        putExtra("message_id", messageId)
        putExtra("topic", topic)
        putExtra("open_payload", openPayload)
      }

    val pendingIntent = launchIntent?.let {
      PendingIntent.getActivity(
        context,
        messageId.hashCode(),
        it,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
    }

    val notification = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentTitle(title)
      .setContentText(body)
      .setStyle(NotificationCompat.BigTextStyle().bigText(body))
      .setPriority(mapPriority(intent.getStringExtra("priority")))
      .setAutoCancel(true)
      .apply {
        if (pendingIntent != null) {
          setContentIntent(pendingIntent)
        }
      }
      .build()

    val stableId = if (messageId.isNotBlank()) messageId.hashCode() else System.currentTimeMillis().toInt()
    NotificationManagerCompat.from(context).notify(stableId, notification)
    Log.i(TAG, "notify posted source=$source id=$stableId title=$title")
  }

  private fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

    val manager = context.getSystemService(NotificationManager::class.java)
    val channel = NotificationChannel(
      CHANNEL_ID,
      CHANNEL_NAME,
      NotificationManager.IMPORTANCE_HIGH
    ).apply {
      description = CHANNEL_DESCRIPTION
    }
    manager.createNotificationChannel(channel)
    Log.i(TAG, "channel ensured id=$CHANNEL_ID")
  }

  private fun mapPriority(priority: String?): Int {
    return when (priority?.lowercase()) {
      "max", "high" -> NotificationCompat.PRIORITY_HIGH
      "low", "min" -> NotificationCompat.PRIORITY_LOW
      else -> NotificationCompat.PRIORITY_DEFAULT
    }
  }
}
