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

    /** Asks again, whenever the user chooses to (the Settings button). Returns false when the phone has no such prompt. */
    @SuppressLint("BatteryLife")
    fun request(context: Context): Boolean = runCatching {
        context.startActivity(
            Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${context.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
        true
    }.getOrDefault(false)

    /**
     * The phone maker's own "let this app run in the background / start by itself" screen. These are not part of Android and
     * differ per maker and version, so each known screen is tried in turn; the app's own details page is the fallback, where
     * Battery > Unrestricted (or "Don't restrict background use") does the same job.
     */
    fun openVendorSettings(context: Context): String {
        val screens = listOf(
            // vivo / iQOO (Funtouch OS, OriginOS)
            "com.vivo.permissionmanager" to "com.vivo.permissionmanager.activity.BgStartUpManagerActivity",
            "com.iqoo.secure" to "com.iqoo.secure.ui.phoneoptimize.BgStartUpManager",
            "com.iqoo.secure" to "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity",
            "com.vivo.abe" to "com.vivo.applicationbehaviorengine.ui.ExcessivePowerManagerActivity",
            // Xiaomi / Redmi / POCO
            "com.miui.securitycenter" to "com.miui.permcenter.autostart.AutoStartManagementActivity",
            // OPPO / realme / OnePlus
            "com.coloros.safecenter" to "com.coloros.safecenter.permission.startup.StartupAppListActivity",
            "com.oplus.battery" to "com.oplus.powermanager.fuelgaue.PowerUsageModelActivity",
            // Samsung
            "com.samsung.android.lool" to "com.samsung.android.sm.battery.ui.BatteryActivity",
            // Huawei / Honor
            "com.huawei.systemmanager" to "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity",
        )
        for ((pkg, cls) in screens) {
            val intent = Intent().setClassName(pkg, cls).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            if (context.packageManager.resolveActivity(intent, 0) != null && runCatching { context.startActivity(intent) }.isSuccess) return "vendor"
        }
        val details = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return if (runCatching { context.startActivity(details) }.isSuccess) "details" else "none"
    }
}
