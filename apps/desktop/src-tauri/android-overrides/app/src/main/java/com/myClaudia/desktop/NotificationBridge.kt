package com.myClaudia.mobile

import android.webkit.JavascriptInterface

class NotificationBridge {
  @JavascriptInterface
  fun consumeSelectionTarget(): String {
    return NotificationSelectionStore.consume() ?: ""
  }

  @JavascriptInterface
  fun peekSelectionTarget(): String {
    return NotificationSelectionStore.peek() ?: ""
  }
}
