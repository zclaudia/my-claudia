package com.myClaudia.desktop

import android.app.Activity
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.webkit.JavascriptInterface
import androidx.core.content.FileProvider
import java.io.File
import java.io.FileInputStream
import java.util.Locale

/**
 * Exposes Android-native file operations to the WebView via @JavascriptInterface.
 * Registered as "AndroidFiles" in MainActivity.
 */
class FileHelper(private val activity: Activity) {

    @JavascriptInterface
    fun saveToDownloads(sourcePath: String, fileName: String, mimeType: String): String {
        val sourceFile = File(sourcePath)
        if (!sourceFile.exists()) {
            throw IllegalArgumentException("Source file does not exist: $sourcePath")
        }
        val safeMimeType = sanitizeMimeType(mimeType)

        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            saveViaMediaStore(sourceFile, fileName, safeMimeType)
        } else {
            saveToPublicDownloads(sourceFile, fileName)
        }
    }

    @JavascriptInterface
    fun openFile(filePath: String, mimeType: String): Boolean {
        activity.runOnUiThread {
            try {
                val normalizedPath = normalizePath(filePath)
                val uri = if (normalizedPath.startsWith("content://")) {
                    Uri.parse(normalizedPath)
                } else {
                    val file = File(normalizedPath)
                    if (!file.exists()) {
                        android.util.Log.e("FileHelper", "File does not exist: $normalizedPath")
                        return@runOnUiThread
                    }
                    FileProvider.getUriForFile(
                        activity,
                        "${activity.packageName}.fileprovider",
                        file
                    )
                }

                val resolvedMimeType = detectMimeType(uri, normalizedPath, mimeType)

                if (!launchWithMime(uri, resolvedMimeType) && !launchWithMime(uri, "*/*")) {
                    android.util.Log.e("FileHelper", "No activity can open: $normalizedPath")
                }
            } catch (e: Exception) {
                android.util.Log.e("FileHelper", "Failed to open file: ${e.message}", e)
            }
        }
        return true
    }

    private fun saveViaMediaStore(sourceFile: File, fileName: String, mimeType: String): String {
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, fileName)
            put(MediaStore.Downloads.MIME_TYPE, mimeType)
            put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
            put(MediaStore.Downloads.IS_PENDING, 1)
        }

        val resolver = activity.contentResolver
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
            ?: throw RuntimeException("Failed to create MediaStore entry")

        try {
            resolver.openOutputStream(uri)?.use { outputStream ->
                FileInputStream(sourceFile).use { inputStream ->
                    inputStream.copyTo(outputStream)
                }
            }

            values.clear()
            values.put(MediaStore.Downloads.IS_PENDING, 0)
            resolver.update(uri, values, null, null)

            return uri.toString()
        } catch (e: Exception) {
            resolver.delete(uri, null, null)
            throw e
        }
    }

    @Suppress("DEPRECATION")
    private fun saveToPublicDownloads(sourceFile: File, fileName: String): String {
        val downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
        if (!downloadsDir.exists()) downloadsDir.mkdirs()

        var destFile = File(downloadsDir, fileName)
        val dotIdx = fileName.lastIndexOf('.')
        val base = if (dotIdx > 0) fileName.substring(0, dotIdx) else fileName
        val ext = if (dotIdx > 0) fileName.substring(dotIdx) else ""
        var counter = 1
        while (destFile.exists()) {
            destFile = File(downloadsDir, "$base ($counter)$ext")
            counter++
        }

        sourceFile.inputStream().use { input ->
            destFile.outputStream().use { output ->
                input.copyTo(output)
            }
        }

        return destFile.absolutePath
    }

    private fun launchWithMime(uri: Uri, mimeType: String): Boolean {
        val openIntent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, mimeType)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            clipData = android.content.ClipData.newRawUri("", uri)
        }

        val handlers = activity.packageManager.queryIntentActivities(
            openIntent,
            PackageManager.MATCH_DEFAULT_ONLY
        )
        if (handlers.isEmpty()) return false

        handlers.forEach { resolved ->
            activity.grantUriPermission(
                resolved.activityInfo.packageName,
                uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION
            )
        }

        return try {
            activity.startActivity(Intent.createChooser(openIntent, "Open with"))
            true
        } catch (_: Exception) {
            false
        }
    }

    private fun detectMimeType(uri: Uri, path: String, mimeType: String): String {
        val sanitized = sanitizeMimeType(mimeType)
        if (sanitized != "application/octet-stream") return sanitized

        val resolverType = activity.contentResolver.getType(uri)
        if (!resolverType.isNullOrBlank()) return resolverType

        val ext = android.webkit.MimeTypeMap.getFileExtensionFromUrl(path)
        if (!ext.isNullOrBlank()) {
            val fromExt = android.webkit.MimeTypeMap.getSingleton()
                .getMimeTypeFromExtension(ext.lowercase(Locale.US))
            if (!fromExt.isNullOrBlank()) return fromExt
        }

        return "application/octet-stream"
    }

    private fun sanitizeMimeType(mimeType: String): String {
        val cleaned = mimeType.trim()
        return if (cleaned.isBlank() || cleaned == "undefined" || cleaned == "null") {
            "application/octet-stream"
        } else {
            cleaned
        }
    }

    private fun normalizePath(path: String): String {
        return if (path.startsWith("file://")) {
            Uri.parse(path).path ?: path
        } else {
            path
        }
    }
}
