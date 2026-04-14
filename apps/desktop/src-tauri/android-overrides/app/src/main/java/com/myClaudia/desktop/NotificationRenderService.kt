package com.myClaudia.desktop

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import android.util.Log

class NotificationRenderService : Service() {
  companion object {
    private const val TAG = "NotificationRenderSvc"
    private const val FOREGROUND_CHANNEL_ID = "ntfy_render_service"
    private const val FOREGROUND_NOTIFICATION_ID = 44001
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    try {
      startAsForegroundService()
      if (intent == null) {
        Log.w(TAG, "onStartCommand with null intent")
      } else {
        Log.i(TAG, "onStartCommand extras=${intent.extras}")
        NotificationRenderer.post(this, intent, "service")
      }
    } catch (t: Throwable) {
      Log.e(TAG, "failed to render notification", t)
    } finally {
      stopForeground(STOP_FOREGROUND_REMOVE)
      stopSelf(startId)
    }
    return START_NOT_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun startAsForegroundService() {
    ensureForegroundChannel()
    startForeground(FOREGROUND_NOTIFICATION_ID, buildForegroundNotification())
  }

  private fun ensureForegroundChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

    val manager = getSystemService(NotificationManager::class.java)
    val channel = NotificationChannel(
      FOREGROUND_CHANNEL_ID,
      "Notification renderer",
      NotificationManager.IMPORTANCE_LOW
    ).apply {
      description = "Keeps notification rendering active briefly in background"
      setShowBadge(false)
    }
    manager.createNotificationChannel(channel)
  }

  private fun buildForegroundNotification(): Notification {
    return NotificationCompat.Builder(this, FOREGROUND_CHANNEL_ID)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentTitle("MyClaudia")
      .setContentText("Rendering notification")
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setOngoing(true)
      .build()
  }
}
