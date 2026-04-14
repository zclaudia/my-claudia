package com.myClaudia.mobile

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

class NtfyReceiver : BroadcastReceiver() {
  companion object {
    private const val TAG = "NtfyReceiver"
  }

  override fun onReceive(context: Context, intent: Intent) {
    try {
      Log.i(TAG, "onReceive action=${intent.action} package=${context.packageName} extras=${intent.extras}")
      NotificationRenderer.post(context, intent, "receiver")
    } catch (t: Throwable) {
      Log.e(TAG, "failed to post notification", t)
    }
  }
}
