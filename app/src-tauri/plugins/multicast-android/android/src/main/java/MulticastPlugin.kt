package com.distllm.multicast

import android.app.Activity
import android.content.Context
import android.net.wifi.WifiManager
import android.view.WindowManager
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class EnabledArgs {
    var enabled: Boolean = false
}

/**
 * Two things Android needs for a device to take part in a split:
 * - a Wi‑Fi multicast lock while discovery runs, or the system drops incoming mDNS packets;
 * - the screen kept on while this device is a worker or host, or it sleeps and the
 *   other devices lose it mid-answer.
 */
@TauriPlugin
class MulticastPlugin(private val activity: Activity) : Plugin(activity) {
    private val lock: WifiManager.MulticastLock by lazy {
        val wifi = activity.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
        wifi.createMulticastLock("distllm-discovery").apply { setReferenceCounted(false) }
    }

    @Command
    fun setMulticast(invoke: Invoke) {
        val args = invoke.parseArgs(EnabledArgs::class.java)
        try {
            if (args.enabled) lock.acquire() else if (lock.isHeld) lock.release()
            invoke.resolve(JSObject().put("held", lock.isHeld))
        } catch (e: Exception) {
            invoke.reject(e.message ?: "multicast lock failed")
        }
    }

    @Command
    fun setKeepAwake(invoke: Invoke) {
        val args = invoke.parseArgs(EnabledArgs::class.java)
        activity.runOnUiThread {
            if (args.enabled) {
                activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            } else {
                activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            }
            invoke.resolve(JSObject().put("enabled", args.enabled))
        }
    }
}
