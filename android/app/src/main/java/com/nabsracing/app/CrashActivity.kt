package com.nabsracing.app

import android.app.Activity
import android.app.Application
import android.content.ClipData
import android.content.ClipboardManager
import android.graphics.Color
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast

// What NabsApp shows when the app has crashed: the error itself, to copy and
// send on. A plain Activity with its views made in code, in a process of its own
// (":crash" in the manifest), so that it depends on as little as possible of
// what may just have broken.
class CrashActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val trace = intent.getStringExtra(EXTRA_TRACE) ?: "No details."
        val report = "NABS Racing ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})\n" +
            "Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT}), ${Build.MANUFACTURER} ${Build.MODEL}\n\n" + trace
        val pad = (16 * resources.displayMetrics.density).toInt()

        val title = TextView(this).apply {
            text = "NABS Racing has crashed"
            textSize = 22f
            setTypeface(typeface, Typeface.BOLD)
            setTextColor(Color.WHITE)
        }
        val lead = TextView(this).apply {
            text = "Please copy the text below and send it to the admins. It says exactly what went wrong."
            textSize = 15f
            setTextColor(Color.LTGRAY)
            setPadding(0, pad / 2, 0, pad)
        }
        val copy = Button(this).apply {
            text = "Copy the error"
            setOnClickListener {
                getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("NABS Racing crash", report))
                Toast.makeText(this@CrashActivity, "Copied", Toast.LENGTH_SHORT).show()
            }
        }
        val details = TextView(this).apply {
            text = report
            textSize = 11f
            typeface = Typeface.MONOSPACE
            setTextColor(Color.LTGRAY)
            setTextIsSelectable(true)
            setPadding(0, pad, 0, pad)
        }
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad * 3, pad, pad)
            addView(title)
            addView(lead)
            addView(copy)
            addView(details)
        }
        setContentView(ScrollView(this).apply {
            setBackgroundColor(Color.parseColor("#080D18"))
            addView(column)
        })
    }

    companion object {
        const val EXTRA_TRACE = "trace"

        fun isCrashProcess(): Boolean =
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && Application.getProcessName().endsWith(":crash")
    }
}
