package com.chomugiri.workspace

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * Keeps a run alive while the app is in the background.
 *
 * Android does not let an app do work off-screen just because it wants to: a
 * backgrounded process is frozen at the system's discretion, which is why a run
 * started and then left died halfway with nothing to show for it. A foreground
 * service is the only sanctioned way to say "this is real work, let it finish",
 * and it is required to post a notification while it runs.
 *
 * So the notification is scoped to the work rather than to the app: it exists
 * only between the first token and the last, carries the topic of what is being
 * built, and is gone the moment the run ends. Nothing is left sitting in the
 * shade afterwards — the completion notice is a separate, dismissible one-shot,
 * posted only when the user is not already watching the run.
 */
class RunService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val topic = intent?.getStringExtra(EXTRA_TOPIC).orEmpty().ifEmpty { "a run" }
        ensureChannels(this)

        val notification = NotificationCompat.Builder(this, CHANNEL_RUNNING)
            .setContentTitle("Chomugiri is working")
            .setContentText(topic)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setOngoing(true)
            .setProgress(0, 0, true)
            // Quiet by design: this is a receipt that work is continuing, not an
            // alert. It never makes a sound and never takes over the screen.
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(openApp(this))
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_RUNNING, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(NOTIFICATION_RUNNING, notification)
        }

        // If the process is killed mid-run the work is gone with it, so there is
        // nothing useful to restart into — a re-delivered intent would only put
        // back a notification for a run that no longer exists.
        return START_NOT_STICKY
    }

    companion object {
        private const val CHANNEL_RUNNING = "chomugiri.runs"
        private const val CHANNEL_DONE = "chomugiri.results"
        private const val NOTIFICATION_RUNNING = 4711
        private const val EXTRA_TOPIC = "topic"
        private var doneId = 4800

        private fun openApp(context: Context): PendingIntent =
            PendingIntent.getActivity(
                context,
                0,
                Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )

        fun ensureChannels(context: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
            val manager = context.getSystemService(NotificationManager::class.java) ?: return
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_RUNNING, "Running", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "Shown only while a run is still going."
                    setShowBadge(false)
                }
            )
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_DONE, "Finished runs", NotificationManager.IMPORTANCE_DEFAULT).apply {
                    description = "One notice when a run you left finishes."
                }
            )
        }

        fun start(context: Context, topic: String) {
            val intent = Intent(context, RunService::class.java).putExtra(EXTRA_TOPIC, topic)
            runCatching {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
                else context.startService(intent)
            }
        }

        fun stop(context: Context) {
            runCatching { context.stopService(Intent(context, RunService::class.java)) }
        }

        /**
         * The one-shot "it's done" notice.
         *
         * Separate from the running notification on purpose: that one is ongoing
         * and cannot be swiped away, this one can, and it is the only thing left
         * behind once the work is over.
         */
        fun notifyFinished(context: Context, title: String, body: String) {
            ensureChannels(context)
            val notification = NotificationCompat.Builder(context, CHANNEL_DONE)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(NotificationCompat.BigTextStyle().bigText(body))
                .setSmallIcon(android.R.drawable.stat_notify_chat)
                .setAutoCancel(true)
                .setContentIntent(openApp(context))
                .build()

            runCatching { NotificationManagerCompat.from(context).notify(doneId++, notification) }
        }
    }
}
