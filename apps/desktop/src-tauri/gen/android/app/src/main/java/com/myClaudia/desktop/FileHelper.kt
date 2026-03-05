package com.myClaudia.desktop

import android.app.Activity
import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.webkit.JavascriptInterface
import androidx.core.content.FileProvider
import java.io.File
import java.io.FileInputStream

/**
 * Exposes Android-native file operations to the WebView via @JavascriptInterface.
 * Registered as "AndroidFiles" in MainActivity.
 */
class FileHelper(private val activity: Activity) {

    /**
     * Copy a file from the app-private directory to the system's shared Downloads folder.
     * Uses MediaStore on API 29+ and direct file copy on API 24-28.
     * Returns the destination path or content URI string.
     */
    @JavascriptInterface
    fun saveToDownloads(sourcePath: String, fileName: String, mimeType: String): String {
        val sourceFile = File(sourcePath)
        if (!sourceFile.exists()) {
            throw IllegalArgumentException("Source file does not exist: $sourcePath")
        }

        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            // API 29+ (Android 10+): Use MediaStore
            saveViaMediaStore(sourceFile, fileName, mimeType)
        } else {
            // API 24-28: Direct file copy to public Downloads
            saveToPublicDownloads(sourceFile, fileName)
        }
    }

    /**
     * Open a file using the system's default app via ACTION_VIEW intent.
     * Uses FileProvider to generate a secure content URI.
     */
    @JavascriptInterface
    fun openFile(filePath: String, mimeType: String) {
        activity.runOnUiThread {
            try {
                val uri = if (filePath.startsWith("content://")) {
                    Uri.parse(filePath)
                } else {
                    val file = File(filePath)
                    if (!file.exists()) {
                        android.util.Log.e("FileHelper", "File does not exist: $filePath")
                        return@runOnUiThread
                    }
                    FileProvider.getUriForFile(
                        activity,
                        "${activity.packageName}.fileprovider",
                        file
                    )
                }

                val resolvedMimeType = mimeType.takeIf { it.isNotBlank() } ?: "application/octet-stream"
                val openIntent = Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(uri, resolvedMimeType)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                }

                try {
                    activity.startActivity(Intent.createChooser(openIntent, "Open with"))
                } catch (_: Exception) {
                    // Fallback for unknown/strict MIME mappings.
                    val fallbackIntent = Intent(Intent.ACTION_VIEW).apply {
                        setDataAndType(uri, "*/*")
                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                    activity.startActivity(Intent.createChooser(fallbackIntent, "Open with"))
                }
            } catch (e: Exception) {
                android.util.Log.e("FileHelper", "Failed to open file: ${e.message}", e)
            }
        }
    }

    private fun saveViaMediaStore(sourceFile: File, fileName: String, mimeType: String): String {
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, fileName)
            put(MediaStore.Downloads.MIME_TYPE, mimeType)
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

            // Mark as complete
            values.clear()
            values.put(MediaStore.Downloads.IS_PENDING, 0)
            resolver.update(uri, values, null, null)

            return uri.toString()
        } catch (e: Exception) {
            // Clean up on failure
            resolver.delete(uri, null, null)
            throw e
        }
    }

    @Suppress("DEPRECATION")
    private fun saveToPublicDownloads(sourceFile: File, fileName: String): String {
        val downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
        if (!downloadsDir.exists()) downloadsDir.mkdirs()

        // Deduplicate filename
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
}
