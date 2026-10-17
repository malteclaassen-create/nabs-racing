package com.nabsracing.app

import android.annotation.SuppressLint
import android.app.Presentation
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.RectF
import android.graphics.drawable.ColorDrawable
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import java.nio.ByteBuffer
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

// Draws one widget as a picture.
//
// The widgets are not built twice. The iPhone widgets' own code (nabs-core.js)
// already runs in a browser: the profile's widget preview draws every widget
// with it. frontend/public/widget-preview/android.html is that preview cut down
// to one widget that fills the page, and this class opens it in a WebView the
// size of the widget, waits for the page to say it is done, and takes a picture.
// A new widget version on the site is on Android phones with their next refresh.
//
// The WebView has to be on a screen to draw. A widget refreshes in the
// background, with no screen of the app's own, so it gets a private one: a
// virtual display that nobody sees, whose frames land in an ImageReader. The
// WebView sits in a Presentation (a window for a second display) on it. If a
// phone refuses that, the fallback lays the WebView out without any screen and
// asks it to draw itself onto a bitmap, which most WebViews also manage.
class WidgetRenderer(private val context: Context) {

    // timers: the running clocks android.js left out of the picture, as the JSON
    // array it sent (LiveTimer, read by WidgetStore.timers).
    class Shot(val bitmap: Bitmap, val url: String?, val refreshAfter: Long?, val timers: String = "[]")

    // The page answered, and it was not a widget (no connection, an error in the
    // widget code, the page missing). Nothing to draw: the widget keeps its old picture.
    class RenderFailed(message: String) : Exception(message)

    // The virtual display did not work out on this phone: try the other way.
    private class CouldNotStart(cause: Throwable) : Exception(cause)
    private class NothingDrawn : Exception("The widget page drew nothing on the virtual display")

    private val main = Handler(Looper.getMainLooper())

    // Throws RenderFailed when there is no picture to be had, never a timeout:
    // a cancellation would end the caller's whole run, not just this widget.
    suspend fun render(url: String, frame: Frame): Shot = withContext(Dispatchers.Main) {
        val radius = CORNER_RADIUS * frame.widthPx / frame.layout.width
        val shot = try {
            withTimeoutOrNull(DISPLAY_TIMEOUT_MS) { onVirtualDisplay(url, frame.widthPx, frame.heightPx) }
                ?: throw NothingDrawn()
        } catch (e: CouldNotStart) {
            Log.w(TAG, "No virtual display, drawing without one", e.cause)
            null
        } catch (e: NothingDrawn) {
            Log.w(TAG, e.message ?: "", e)
            null
        } ?: withTimeoutOrNull(FALLBACK_TIMEOUT_MS) { withoutDisplay(url, frame.widthPx, frame.heightPx) }
            ?: throw RenderFailed("The widget took too long to draw")
        Shot(rounded(shot.bitmap, radius), shot.url, shot.refreshAfter, shot.timers)
    }

    @SuppressLint("WrongConstant")
    private suspend fun onVirtualDisplay(url: String, w: Int, h: Int): Shot = suspendCancellableCoroutine { cont ->
        val reader = ImageReader.newInstance(w, h, PixelFormat.RGBA_8888, 2)
        var display: VirtualDisplay? = null
        var presentation: Presentation? = null
        var web: WebView? = null
        var finished = false

        fun cleanup() {
            if (finished) return
            finished = true
            presentation?.dismiss()
            web?.destroy()
            display?.release()
            reader.close()
        }
        cont.invokeOnCancellation { main.post { cleanup() } }

        fun fail(e: Throwable) {
            if (finished) return
            cleanup()
            if (cont.isActive) cont.resumeWithException(e)
        }

        // The finished widget is in a frame that is on its way to the display:
        // take the newest one there is, and wait a little if none has landed yet.
        fun grab(report: Report, tries: Int) {
            if (finished) return
            val image = try {
                reader.acquireLatestImage()
            } catch (e: Exception) {
                fail(e)
                return
            }
            if (image == null) {
                if (tries <= 0) fail(NothingDrawn()) else main.postDelayed({ grab(report, tries - 1) }, 100)
                return
            }
            val bitmap = try {
                // Row by row: a display's rows can be padded past the picture's
                // width, and the last one often is not, so the buffer is not one
                // neat block of rowStride * h bytes.
                val plane = image.planes[0]
                val src = plane.buffer
                val rowBytes = w * plane.pixelStride
                val pixels = ByteArray(rowBytes * h)
                for (y in 0 until h) {
                    src.position(y * plane.rowStride)
                    src.get(pixels, y * rowBytes, rowBytes)
                }
                Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888).apply { copyPixelsFromBuffer(ByteBuffer.wrap(pixels)) }
            } catch (e: Exception) {
                fail(e)
                return
            } finally {
                image.close()
            }
            // A widget always has text on it: a picture of one single colour (clear,
            // or black) means the display showed nothing of the window.
            if (isBlank(bitmap)) {
                fail(NothingDrawn())
                return
            }
            cleanup()
            if (cont.isActive) cont.resume(Shot(bitmap, report.url, report.refreshAfter, report.timers))
        }

        try {
            val dm = context.getSystemService(DisplayManager::class.java)
            display = dm.createVirtualDisplay("nabs-widget", w, h, context.resources.displayMetrics.densityDpi, reader.surface, 0)
            val p = Presentation(context, display.display)
            presentation = p
            p.window?.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
            val v = newWebView(p.context, onDone = { report ->
                if (!report.ok) fail(RenderFailed(report.error ?: "The widget could not be drawn"))
                else web?.postVisualStateCallback(0, object : WebView.VisualStateCallback() {
                    override fun onComplete(requestId: Long) {
                        main.postDelayed({ grab(report, 20) }, 200)
                    }
                })
            }, onError = ::fail)
            web = v
            p.setContentView(v, ViewGroup.LayoutParams(w, h))
            p.show()
            v.loadUrl(url)
        } catch (e: Exception) {
            fail(CouldNotStart(e))
        }
    }

    private suspend fun withoutDisplay(url: String, w: Int, h: Int): Shot = suspendCancellableCoroutine { cont ->
        var web: WebView? = null
        var finished = false

        fun cleanup() {
            if (finished) return
            finished = true
            web?.destroy()
        }
        cont.invokeOnCancellation { main.post { cleanup() } }

        fun fail(e: Throwable) {
            if (finished) return
            cleanup()
            if (cont.isActive) cont.resumeWithException(e)
        }

        val v = newWebView(context, onDone = { report ->
            if (!report.ok) {
                fail(RenderFailed(report.error ?: "The widget could not be drawn"))
            } else {
                main.postDelayed({
                    if (!finished) {
                        val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
                        web?.draw(Canvas(bitmap))
                        if (isBlank(bitmap)) {
                            fail(RenderFailed("This phone's WebView drew nothing off screen"))
                        } else {
                            cleanup()
                            if (cont.isActive) cont.resume(Shot(bitmap, report.url, report.refreshAfter, report.timers))
                        }
                    }
                }, 500)
            }
        }, onError = ::fail)
        web = v
        v.measure(View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY))
        v.layout(0, 0, w, h)
        v.loadUrl(url)
    }

    private class Report(val ok: Boolean, val url: String?, val refreshAfter: Long?, val error: String?, val timers: String = "[]")

    // What android.js reports back through window.NabsWidget.done(json).
    class Bridge(private val main: Handler, private val onDone: (String) -> Unit) {
        private var called = false

        @JavascriptInterface
        fun done(json: String) {
            main.post {
                if (!called) {
                    called = true
                    onDone(json)
                }
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun newWebView(ctx: Context, onDone: (Report) -> Unit, onError: (Throwable) -> Unit): WebView {
        val v = WebView(ctx)
        v.setBackgroundColor(Color.TRANSPARENT)
        v.isVerticalScrollBarEnabled = false
        v.isHorizontalScrollBarEnabled = false
        v.settings.apply {
            javaScriptEnabled = true
            // The phone's font size setting would otherwise scale the text, and the
            // widget's layout is worked out for its own sizes.
            textZoom = 100
            offscreenPreRaster = true
            userAgentString = "$userAgentString NABS-Android/${BuildConfig.VERSION_NAME}"
        }
        v.addJavascriptInterface(Bridge(main) { json ->
            val r = try {
                val o = JSONObject(json)
                Report(
                    ok = o.optBoolean("ok"),
                    url = o.optString("url").takeIf { it.isNotBlank() && it != "null" },
                    refreshAfter = if (o.isNull("refreshAfter")) null else o.optLong("refreshAfter"),
                    error = o.optString("error").takeIf { it.isNotBlank() && it != "null" },
                    timers = o.optJSONArray("timers")?.toString() ?: "[]",
                )
            } catch (e: Exception) {
                Report(false, null, null, "Unreadable answer from the widget page")
            }
            onDone(r)
        }, "NabsWidget")
        v.webViewClient = object : WebViewClient() {
            // The page itself not loading (no connection, or not on the site yet)
            // is the end of it; a missing picture inside it is the widget's business.
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) onError(RenderFailed("No connection (${error.description})"))
            }

            override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
                if (request.isForMainFrame) onError(RenderFailed("The widget page answered ${response.statusCode}"))
            }

            // It is a picture: nothing in it goes anywhere.
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = true
        }
        v.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(m: ConsoleMessage): Boolean {
                Log.d(TAG, "page: ${m.message()} (${m.sourceId()}:${m.lineNumber()})")
                return true
            }
        }
        return v
    }

    private fun isBlank(b: Bitmap): Boolean {
        val px = IntArray(b.width * b.height)
        b.getPixels(px, 0, b.width, 0, 0, b.width, b.height)
        val first = px[0]
        return px.all { it == first }
    }

    // The widget's own rounded corners, cut clean: whatever a display put behind
    // them stays out of the picture.
    private fun rounded(src: Bitmap, radius: Float): Bitmap {
        val out = Bitmap.createBitmap(src.width, src.height, Bitmap.Config.ARGB_8888)
        val c = Canvas(out)
        val p = Paint(Paint.ANTI_ALIAS_FLAG)
        c.drawRoundRect(RectF(0f, 0f, src.width.toFloat(), src.height.toFloat()), radius, radius, p)
        p.xfermode = PorterDuffXfermode(PorterDuff.Mode.SRC_IN)
        c.drawBitmap(src, 0f, 0f, p)
        return out
    }

    companion object {
        private const val TAG = "NabsWidget"
        // Time for the page, its data and the picture: a slow mobile connection
        // on its own takes a few seconds. The fallback gets what is left of a minute.
        private const val DISPLAY_TIMEOUT_MS = 35_000L
        private const val FALLBACK_TIMEOUT_MS = 25_000L
        // The iPhone widget's corner (.sw-widget in android.html), in iPhone points.
        private const val CORNER_RADIUS = 22f
    }
}
