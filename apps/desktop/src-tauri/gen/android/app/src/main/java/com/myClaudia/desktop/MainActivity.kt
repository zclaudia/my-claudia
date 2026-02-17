package com.myClaudia.desktop

import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import androidx.activity.OnBackPressedCallback

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    // Intercept Android back gesture / back button and forward to WebView
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        // Dispatch a custom event to the WebView; frontend JS handles the logic
        val webView = findWebView()
        if (webView != null) {
          webView.evaluateJavascript(
            "window.dispatchEvent(new Event('android-back'))",
            null
          )
        } else {
          // Fallback: let system handle it
          isEnabled = false
          onBackPressedDispatcher.onBackPressed()
          isEnabled = true
        }
      }
    })
  }

  /** Walk the view hierarchy to find the WebView used by Tauri */
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
