package com.nabsracing.app

import android.annotation.SuppressLint
import android.appwidget.AppWidgetManager
import android.content.Intent
import android.graphics.Color
import android.graphics.Rect
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.Editable
import android.text.TextWatcher
import android.view.View
import android.view.ViewGroup
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.AutoCompleteTextView
import android.widget.Button
import android.widget.CheckBox
import android.widget.FrameLayout
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import kotlin.concurrent.thread

// The settings of one widget: shown when a widget is placed on the home screen,
// and again from the widget's own settings (long press). The questions are the
// ones the iPhone setup asks (NABS Setup in Scriptable), and the preview is the
// real thing: the same page draws it that draws the widget.
class WidgetConfigActivity : AppCompatActivity() {

    private var widgetId = AppWidgetManager.INVALID_APPWIDGET_ID
    private lateinit var store: WidgetStore
    private lateinit var kind: Spinner
    private lateinit var series: RadioGroup
    private lateinit var driver: AutoCompleteTextView
    private lateinit var tier: CheckBox
    private lateinit var preview: FrameLayout
    private lateinit var previewNote: TextView
    private var web: WebView? = null
    private val main = Handler(Looper.getMainLooper())
    private val redraw = Runnable { drawPreview() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Leaving without saving takes the new widget off the home screen again.
        setResult(RESULT_CANCELED)
        widgetId = intent?.extras?.getInt(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
            ?: AppWidgetManager.INVALID_APPWIDGET_ID
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
            finish()
            return
        }
        setContentView(R.layout.activity_config)
        fitAroundBarsAndKeyboard()
        store = WidgetStore(this)
        val existing = store.config(widgetId)
        val start = existing ?: store.defaults()

        kind = findViewById(R.id.kind)
        series = findViewById(R.id.series)
        driver = findViewById(R.id.driver)
        tier = findViewById(R.id.tier)
        preview = findViewById(R.id.preview)
        previewNote = findViewById(R.id.previewNote)

        kind.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, WIDGET_KINDS.map { it.name })
        kind.setSelection(WIDGET_KINDS.indexOfFirst { it.view == start.view }.coerceAtLeast(0))
        kind.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                describe()
                drawPreview()
            }

            override fun onNothingSelected(parent: AdapterView<*>?) {}
        }

        SERIES.forEachIndexed { i, s ->
            series.addView(RadioButton(this).apply {
                id = View.generateViewId()
                text = s.label
                tag = s.slug
                minHeight = (48 * resources.displayMetrics.density).toInt()
                isChecked = s.slug == start.series || (i == 0 && SERIES.none { it.slug == start.series })
            })
        }
        series.setOnCheckedChangeListener { _, _ ->
            loadDrivers()
            drawPreview()
        }

        driver.setText(start.driver)
        driver.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun afterTextChanged(s: Editable?) {
                describe()
                // Not a picture per letter: once the typing stops.
                main.removeCallbacks(redraw)
                main.postDelayed(redraw, 700)
            }
        })
        tier.isChecked = start.tierOnly
        tier.setOnCheckedChangeListener { _, _ -> drawPreview() }

        findViewById<Button>(R.id.save).apply {
            setText(if (existing != null) R.string.config_save else R.string.config_add)
            setOnClickListener { save() }
        }

        sizePreview()
        describe()
        loadDrivers()
    }

    override fun onDestroy() {
        main.removeCallbacks(redraw)
        web?.destroy()
        web = null
        super.onDestroy()
    }

    // Android 15 and later draw every app edge to edge: the status bar sits on top
    // of the screen, the keyboard over its lower half, and nothing moves out of
    // their way unless the screen does it. So the content is padded by both,
    // always (the same on older phones), and the field being typed in is
    // scrolled back into sight when the keyboard comes up.
    private fun fitAroundBarsAndKeyboard() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val scroll = findViewById<ScrollView>(R.id.scroll)
        ViewCompat.setOnApplyWindowInsetsListener(scroll) { v, insets ->
            val around = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
            v.setPadding(around.left, around.top, around.right, around.bottom)
            currentFocus?.let { f -> v.post { f.requestRectangleOnScreen(Rect(0, 0, f.width, f.height)) } }
            insets
        }
    }

    private fun current() = WidgetConfig(
        view = WIDGET_KINDS[kind.selectedItemPosition.coerceAtLeast(0)].view,
        series = series.findViewById<RadioButton>(series.checkedRadioButtonId)?.tag as? String ?: "",
        driver = driver.text.toString().trim(),
        tierOnly = tier.isChecked,
    )

    private fun describe() {
        val k = WIDGET_KINDS[kind.selectedItemPosition.coerceAtLeast(0)]
        findViewById<TextView>(R.id.blurb).text = k.blurb
        val note = findViewById<TextView>(R.id.driverNote)
        val missing = k.driver && driver.text.isBlank()
        note.setText(if (k.driver) R.string.config_driver_needed else R.string.config_driver_optional)
        note.setTextColor(if (missing) getColor(R.color.nabs_pink) else getColor(R.color.widget_text_dim))
    }

    // The preview has the shape of the widget on the home screen (or of a 4 x 2
    // while the launcher has not said yet), as wide as the screen allows.
    private fun layout(): Layout {
        val (w, h) = NabsWidgetProvider.sizeDp(AppWidgetManager.getInstance(this), widgetId)
        return layoutFor(w, h)
    }

    private fun sizePreview() {
        val l = layout()
        preview.post {
            val width = preview.width.takeIf { it > 0 } ?: return@post
            preview.layoutParams = preview.layoutParams.apply { height = width * l.height / l.width }
            drawPreview()
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun drawPreview() {
        if (preview.height <= 0) return
        val v = web ?: WebView(this).also { v ->
            v.setBackgroundColor(Color.TRANSPARENT)
            v.settings.javaScriptEnabled = true
            v.settings.textZoom = 100
            v.isVerticalScrollBarEnabled = false
            v.webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView, url: String) {
                    previewNote.visibility = View.GONE
                }

                override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                    if (request.isForMainFrame) {
                        previewNote.setText(R.string.config_preview_failed)
                        previewNote.visibility = View.VISIBLE
                    }
                }

                // It is a preview: a tap stays here.
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = true
            }
            preview.addView(v, 0, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            web = v
        }
        // The preview is the page itself, live: its clocks tick in it already.
        v.loadUrl(renderUrl(current(), layout(), liveTimers = false))
    }

    // The drivers of the chosen series, offered as you type: the name has to be
    // the one on nabsracing.com, and this is the list the site itself knows.
    private fun loadDrivers() {
        val slug = current().series
        thread {
            val names = try {
                val url = URL("$BASE_URL/api/widget" + if (slug.isNotEmpty()) "?series=" + URLEncoder.encode(slug, "UTF-8") else "")
                val c = url.openConnection() as HttpURLConnection
                c.connectTimeout = 10_000
                c.readTimeout = 10_000
                val body = c.inputStream.bufferedReader().use { it.readText() }
                val st = JSONObject(body).optJSONArray("standings")
                (0 until (st?.length() ?: 0)).mapNotNull { st!!.optJSONObject(it)?.optString("driver")?.takeIf(String::isNotBlank) }
            } catch (e: Exception) {
                emptyList()
            }
            runOnUiThread {
                if (!isFinishing && names.isNotEmpty()) {
                    driver.setAdapter(ArrayAdapter(this, android.R.layout.simple_dropdown_item_1line, names))
                }
            }
        }
    }

    private fun save() {
        val config = current()
        store.save(widgetId, config)
        val manager = AppWidgetManager.getInstance(this)
        NabsWidgetProvider.show(this, manager, widgetId, store.picture(widgetId), store.tapUrl(widgetId), timers = store.timers(widgetId))
        WidgetWorker.refreshNow(this)
        setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId))
        finish()
    }
}
