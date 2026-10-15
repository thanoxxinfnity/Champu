package com.chomugiri.workspace

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings

/**
 * On stock Android, a correctly implemented foreground service (RunService) survives being
 * swiped from recents — only Force Stop or the system reclaiming memory kills it. Several OEMs
 * (MIUI/HyperOS, ColorOS, OriginOS, Realme UI, and others) ship their own, more aggressive
 * battery manager on top of that, which kills a foreground service — notification and all — the
 * moment the app is swiped away, regardless of what Android itself would have allowed. Asking to
 * be exempted from *that* is the one thing an app is actually permitted to do about it; nothing
 * in code can make a swiped-away run survive without it on an affected phone.
 */
object BatteryOptimization {
    private const val PREFS = "chomugiri_prefs"
    private const val KEY_ASKED = "battery_opt_asked"

    fun isExempt(context: Context): Boolean {
        val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return true
        return pm.isIgnoringBatteryOptimizations(context.packageName)
    }

    /**
     * Shows the system's own "allow unrestricted background activity" prompt, at most once ever
     * (per install) if the user declines or dismisses it — a run that fails to survive a swipe
     * after that is a choice the user already made, not something to keep interrupting them about.
     * Call this when a real run actually starts, not on app launch — the ask should be tied to a
     * moment where the reason for it is obvious.
     */
    @SuppressLint("BatteryLife")
    fun requestExemptionOnce(context: Context) {
        if (isExempt(context)) return
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (prefs.getBoolean(KEY_ASKED, false)) return
        prefs.edit().putBoolean(KEY_ASKED, true).apply()
        runCatching {
            val intent = Intent(
                Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                Uri.parse("package:${context.packageName}"),
            )
            context.startActivity(intent)
        }
    }
}
