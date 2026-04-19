package com.myClaudia.mobile

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  private val notificationPermissionRequestCode = 1001

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    handleLaunchIntent(intent)
    requestNotificationPermissionIfNeeded()

    // Register native file helper for WebView (save to Downloads, open files)
    // Tauri's WebView may not exist yet after one frame; retry until found.
    registerNativeBridgesWhenReady()

    // Intercept Android back gesture / back button and forward to WebView.
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        val webView = findWebView()
        if (webView != null) {
          webView.evaluateJavascript(
            """
              (() => {
                const event = new Event('android-back', { cancelable: true });
                window.dispatchEvent(event);
                return event.defaultPrevented;
              })()
            """.trimIndent()
          ) { result ->
            val handled = result == "true"
            if (!handled) {
              runOnUiThread {
                isEnabled = false
                onBackPressedDispatcher.onBackPressed()
                isEnabled = true
              }
            }
          }
        } else {
          isEnabled = false
          onBackPressedDispatcher.onBackPressed()
          isEnabled = true
        }
      }
    })
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    handleLaunchIntent(intent)
  }

  private fun requestNotificationPermissionIfNeeded() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return

    val granted = ContextCompat.checkSelfPermission(
      this,
      Manifest.permission.POST_NOTIFICATIONS
    ) == PackageManager.PERMISSION_GRANTED

    if (!granted) {
      ActivityCompat.requestPermissions(
        this,
        arrayOf(Manifest.permission.POST_NOTIFICATIONS),
        notificationPermissionRequestCode
      )
    }
  }

  private fun registerNativeBridgesWhenReady(attempt: Int = 0) {
    val handler = Handler(Looper.getMainLooper())
    handler.post {
      val webView = findWebView()
      if (webView != null) {
        webView.addJavascriptInterface(FileHelper(this@MainActivity), "AndroidFiles")
        webView.addJavascriptInterface(NotificationBridge(), "AndroidNotifications")
        dispatchPendingSelectionTarget(webView)
        android.util.Log.i("MainActivity", "AndroidFiles bridge registered (attempt $attempt)")
      } else if (attempt < 20) {
        handler.postDelayed({ registerNativeBridgesWhenReady(attempt + 1) }, 100)
      } else {
        android.util.Log.e("MainActivity", "Failed to find WebView after $attempt attempts")
      }
    }
  }

  private fun handleLaunchIntent(intent: Intent?) {
    val selectionTarget = extractSelectionTarget(intent)
    if (selectionTarget == null) return

    NotificationSelectionStore.replace(selectionTarget)
    findWebView()?.let { dispatchPendingSelectionTarget(it) }
  }

  private fun extractSelectionTarget(intent: Intent?): String? {
    if (intent == null) return null
    val openPayload = intent.getStringExtra("open_payload")?.trim().orEmpty()
    if (openPayload.isNotEmpty()) return openPayload

    val dataString = intent.dataString?.trim().orEmpty()
    if (dataString.isNotEmpty()) return dataString

    return null
  }

  private fun dispatchPendingSelectionTarget(webView: android.webkit.WebView) {
    val rawTarget = NotificationSelectionStore.consume() ?: return
    val escapedTarget = org.json.JSONObject.quote(rawTarget)
    webView.evaluateJavascript(
      """
        (() => {
          window.__MY_CLAUDIA_PENDING_SELECTION_TARGET__ = $escapedTarget;
          window.dispatchEvent(new CustomEvent('myclaudia:selection-target', {
            detail: $escapedTarget,
          }));
        })()
      """.trimIndent(),
      null
    )
  }

  private fun findWebView(): android.webkit.WebView? {
    return findWebViewIn(window.decorView)
  }

  private fun findWebViewIn(view: android.view.View): android.webkit.WebView? {
    if (view is android.webkit.WebView) return view
    if (view is android.view.ViewGroup) {
      for (i in 0 until view.childCount) {
        val result = findWebViewIn(view.getChildAt(i))
        if (result != null) return result
      }
    }
    return null
  }
}
