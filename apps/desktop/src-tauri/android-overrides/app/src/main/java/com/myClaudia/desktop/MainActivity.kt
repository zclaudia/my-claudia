package com.myClaudia.desktop

import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    // Register native file helper for WebView (save to Downloads, open files)
    // Tauri's WebView may not exist yet after one frame; retry until found.
    registerFileHelperWhenReady()

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

  private fun registerFileHelperWhenReady(attempt: Int = 0) {
    val handler = Handler(Looper.getMainLooper())
    handler.post {
      val webView = findWebView()
      if (webView != null) {
        webView.addJavascriptInterface(FileHelper(this@MainActivity), "AndroidFiles")
        android.util.Log.i("MainActivity", "AndroidFiles bridge registered (attempt $attempt)")
      } else if (attempt < 20) {
        handler.postDelayed({ registerFileHelperWhenReady(attempt + 1) }, 100)
      } else {
        android.util.Log.e("MainActivity", "Failed to find WebView after $attempt attempts")
      }
    }
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
