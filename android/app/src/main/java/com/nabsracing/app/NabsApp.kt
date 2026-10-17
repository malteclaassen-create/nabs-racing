package com.nabsracing.app

import android.app.Application
import android.content.Context
import android.content.Intent
import android.os.Process
import android.util.Log
import java.io.PrintWriter
import java.io.StringWriter
import kotlin.system.exitProcess

// The app as a whole. Its one job: when something crashes, show what crashed.
//
// The app is a download, not a Play Store app, so no crash report ever reaches
// anybody; and phones show only "the app has an error". Instead, the crash is
// written down and CrashActivity (its own process, so it survives the crash)
// shows it with a button to copy it, ready to send to whoever looks after the app.
//
// Set up in attachBaseContext rather than onCreate: content providers (WorkManager's
// start-up among them) run between the two, and a crash there is a crash too.
class NabsApp : Application() {

    override fun attachBaseContext(base: Context) {
        super.attachBaseContext(base)
        if (CrashActivity.isCrashProcess()) return
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            try {
                val trace = StringWriter().also { error.printStackTrace(PrintWriter(it)) }.toString()
                Log.e("NabsApp", "Crash on ${thread.name}", error)
                startActivity(
                    Intent(this, CrashActivity::class.java)
                        .putExtra(CrashActivity.EXTRA_TRACE, "Thread: ${thread.name}\n\n$trace")
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK),
                )
            } catch (e: Throwable) {
                // Nothing more to be done: let Android handle it as it would have.
                previous?.uncaughtException(thread, error)
                return@setDefaultUncaughtExceptionHandler
            }
            Process.killProcess(Process.myPid())
            exitProcess(10)
        }
    }
}
