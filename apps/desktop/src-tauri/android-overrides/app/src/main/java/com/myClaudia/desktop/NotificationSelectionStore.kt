package com.myClaudia.mobile

object NotificationSelectionStore {
  @Volatile
  private var pendingSelectionTarget: String? = null

  fun replace(rawTarget: String?) {
    pendingSelectionTarget = rawTarget?.trim()?.takeIf { it.isNotEmpty() }
  }

  fun peek(): String? = pendingSelectionTarget

  fun consume(): String? {
    val current = pendingSelectionTarget
    pendingSelectionTarget = null
    return current
  }
}
