package com.nabsracing.app

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import org.json.JSONArray
import java.io.File

// What the app remembers about its widgets: each one's settings, the page a tap
// opens, and its last picture (so a launcher restart or a phone without signal
// shows the last widget, not "Loading…"). Plus the driver name and series last
// used, which a new widget starts from.
class WidgetStore(context: Context) {
    private val prefs = context.getSharedPreferences("widgets", Context.MODE_PRIVATE)
    private val pictures = File(context.filesDir, "widgets")

    fun config(id: Int): WidgetConfig? {
        val view = prefs.getString("$id.view", null) ?: return null
        return WidgetConfig(
            view = view,
            series = prefs.getString("$id.series", "") ?: "",
            driver = prefs.getString("$id.driver", "") ?: "",
            tierOnly = prefs.getBoolean("$id.tier", false),
        )
    }

    fun save(id: Int, c: WidgetConfig) {
        prefs.edit()
            .putString("$id.view", c.view)
            .putString("$id.series", c.series)
            .putString("$id.driver", c.driver)
            .putBoolean("$id.tier", c.tierOnly)
            // the next widget starts from these
            .putString("last.driver", c.driver)
            .putString("last.series", c.series)
            .putBoolean("last.tier", c.tierOnly)
            .apply()
    }

    // A new widget's starting point: the last one's driver and series.
    fun defaults() = WidgetConfig(
        view = "auto",
        series = prefs.getString("last.series", "") ?: "",
        driver = prefs.getString("last.driver", "") ?: "",
        tierOnly = prefs.getBoolean("last.tier", false),
    )

    fun tapUrl(id: Int): String? = prefs.getString("$id.url", null)

    fun setTapUrl(id: Int, url: String?) {
        prefs.edit().putString("$id.url", url).apply()
    }

    // The running clocks that go over the picture (LiveTimer), as android.js
    // sent them with it.
    fun timers(id: Int): List<LiveTimer> = try {
        val a = JSONArray(prefs.getString("$id.timers", "[]") ?: "[]")
        (0 until a.length()).map { i ->
            val o = a.getJSONObject(i)
            LiveTimer(
                target = o.getLong("target"),
                x = o.getDouble("x").toFloat(),
                y = o.getDouble("y").toFloat(),
                w = o.getDouble("w").toFloat(),
                h = o.getDouble("h").toFloat(),
                size = o.getDouble("size").toFloat(),
                color = o.optString("color", "#FFFFFF"),
                align = o.optString("align", "left"),
            )
        }
    } catch (e: Exception) {
        emptyList()
    }

    fun setTimers(id: Int, json: String) {
        prefs.edit().putString("$id.timers", json).apply()
    }

    fun picture(id: Int): Bitmap? {
        val f = File(pictures, "$id.png")
        return if (f.exists()) BitmapFactory.decodeFile(f.path) else null
    }

    fun savePicture(id: Int, bitmap: Bitmap) {
        pictures.mkdirs()
        val tmp = File(pictures, "$id.tmp")
        tmp.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        tmp.renameTo(File(pictures, "$id.png"))
    }

    fun forget(id: Int) {
        prefs.edit().apply {
            for (k in listOf("view", "series", "driver", "tier", "url", "timers")) remove("$id.$k")
        }.apply()
        File(pictures, "$id.png").delete()
    }
}
