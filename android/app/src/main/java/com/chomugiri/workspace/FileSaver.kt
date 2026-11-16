package com.chomugiri.workspace

import android.app.PendingIntent
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import java.io.File

/**
 * Puts a file the page hands over into the phone's Downloads.
 *
 * A WebView does not download: a tap on a blob: or data: link does nothing unless the app handles it, which is why every "save"
 * in the app (a file the assistant sent, an APK it built, a zip of the project) appeared to work and left nothing on the phone.
 * On Android 10 and newer the file goes into Download/Chomugiri through MediaStore, which needs no storage permission. A quiet
 * notification says where it is; tapping it opens the file (for an APK, Android's own installer, which asks first).
 */
object FileSaver {
    private const val CHANNEL = "chomugiri.results"
    private var id = 5200

    fun save(context: Context, rawName: String, mime: String, bytes: ByteArray): String {
        val name = rawName.replace(Regex("""[\\/:*?"<>|\u0000-\u001f]"""), "_").trim().take(120).ifEmpty { "file" }
        val type = if (name.endsWith(".apk", true)) "application/vnd.android.package-archive" else mime
        val (uri, where) = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, name)
                put(MediaStore.Downloads.MIME_TYPE, type)
                put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Chomugiri")
                put(MediaStore.Downloads.IS_PENDING, 1)
            }
            val resolver = context.contentResolver
            val target = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: error("the phone refused to create the file")
            try {
                (resolver.openOutputStream(target) ?: error("the file could not be opened")).use { it.write(bytes) }
                resolver.update(target, ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null)
            } catch (e: Exception) {
                runCatching { resolver.delete(target, null, null) }
                throw e
            }
            target to "Download/Chomugiri/$name"
        } else {
            // Before Android 10 a shared folder needs a storage permission; the app's own files folder does not.
            val dir = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: context.filesDir
            val file = File(dir, name)
            file.writeBytes(bytes)
            Uri.fromFile(file) to file.absolutePath
        }
        notifySaved(context, name, uri, type, where)
        return where
    }

    private fun notifySaved(context: Context, name: String, uri: Uri, mime: String, where: String) {
        RunService.ensureChannels(context)
        val open = Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        val tap = PendingIntent.getActivity(context, id, Intent.createChooser(open, name), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val notification = NotificationCompat.Builder(context, CHANNEL)
            .setContentTitle("Saved: $name")
            .setContentText(where)
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(ContextCompat.getColor(context, R.color.ic_launcher_accent))
            .setAutoCancel(true)
            .setContentIntent(tap)
            .build()
        runCatching { NotificationManagerCompat.from(context).notify(id++, notification) }
    }
}
