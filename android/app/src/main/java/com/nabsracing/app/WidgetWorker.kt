package com.nabsracing.app

import android.appwidget.AppWidgetManager
import android.content.Context
import android.util.Log
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.CancellationException
import java.util.concurrent.TimeUnit

// Draws every NABS widget on the home screen afresh, then books its own next run
// for when the widgets asked to be redrawn: every few minutes on a race night,
// every couple of hours on a quiet week (nextRefresh in nabs-core.js, clamped by
// nextRefresh in WidgetSpec.kt). Android may run it a little later than booked
// to save battery; that is the deal every widget gets.
class WidgetWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val ctx = applicationContext
        val manager = AppWidgetManager.getInstance(ctx)
        val store = WidgetStore(ctx)
        val renderer = WidgetRenderer(ctx)
        val density = ctx.resources.displayMetrics.density
        val now = System.currentTimeMillis()
        var next: Long? = null
        var failed = false

        val ids = NabsWidgetProvider.ids(ctx)
        for (id in ids) {
            // A widget still waiting for its settings screen to finish has none yet.
            val config = store.config(id) ?: continue
            val (w, h) = NabsWidgetProvider.sizeDp(manager, id)
            val frame = frameFor(w, h, density)
            try {
                val shot = renderer.render(renderUrl(config, frame.layout), frame)
                store.savePicture(id, shot.bitmap)
                store.setTapUrl(id, shot.url)
                store.setTimers(id, shot.timers)
                val timers = store.timers(id)
                NabsWidgetProvider.show(ctx, manager, id, shot.bitmap, shot.url, timers = timers)
                val wants = nextRefresh(now, shot.refreshAfter, timers.minOfOrNull { it.target })
                next = if (next == null) wants else minOf(next, wants)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.w(TAG, "Widget $id could not be drawn", e)
                failed = true
                // Keep the last picture; with none, say why the widget is empty.
                val old = store.picture(id)
                if (old == null) NabsWidgetProvider.show(ctx, manager, id, null, store.tapUrl(id), note = ctx.getString(R.string.widget_offline))
            }
        }

        if (ids.isNotEmpty()) {
            // Something went wrong (usually: no signal): try again in a quarter of an hour.
            val retry = if (failed) now + 15 * 60_000L else null
            val at = listOfNotNull(next, retry).minOrNull() ?: nextRefresh(now, null)
            schedule(ctx, at - System.currentTimeMillis())
        }
        return Result.success()
    }

    companion object {
        private const val TAG = "NabsWidget"
        private const val WORK = "nabs-widgets"

        private val online = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

        // A widget was added, changed or resized, or the launcher asked: draw now.
        // One name for every run, so a fresh request replaces the booked one
        // rather than adding a second.
        fun refreshNow(context: Context) = schedule(context, 0)

        fun stop(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(WORK)
        }

        // Replacing the run that is booking this (the worker calls it as its last
        // step) cancels that run, which by then has nothing left to do.
        private fun schedule(context: Context, delayMs: Long) {
            val request = OneTimeWorkRequestBuilder<WidgetWorker>()
                .setConstraints(online)
                .setInitialDelay(delayMs.coerceAtLeast(0), TimeUnit.MILLISECONDS)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(WORK, ExistingWorkPolicy.REPLACE, request)
        }
    }
}
