package com.nabsracing.app

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.SizeF
import android.view.View
import android.widget.RemoteViews
import com.google.androidbrowserhelper.trusted.LauncherActivity

// The widget as Android sees it. All it does itself is put up what it already
// has (the last picture) and ask WidgetWorker for a fresh one: drawing takes a
// few seconds and a network, more than a broadcast receiver is given.
class NabsWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        val store = WidgetStore(context)
        for (id in ids) show(context, manager, id, store.picture(id), store.tapUrl(id))
        WidgetWorker.refreshNow(context)
    }

    override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, options: Bundle) {
        // Resized: maybe a different layout, certainly a different picture.
        WidgetWorker.refreshNow(context)
    }

    override fun onDeleted(context: Context, ids: IntArray) {
        val store = WidgetStore(context)
        for (id in ids) store.forget(id)
    }

    override fun onDisabled(context: Context) {
        WidgetWorker.stop(context)
    }

    companion object {
        fun ids(context: Context): IntArray =
            AppWidgetManager.getInstance(context).getAppWidgetIds(ComponentName(context, NabsWidgetProvider::class.java))

        // The widget's picture, or "Loading…" until there is one. A tap opens the
        // page the widget is about, in the app.
        fun show(context: Context, manager: AppWidgetManager, id: Int, picture: Bitmap?, url: String?, note: String? = null) {
            val views = RemoteViews(context.packageName, R.layout.widget)
            if (picture != null) {
                views.setImageViewBitmap(R.id.image, picture)
                views.setViewVisibility(R.id.image, View.VISIBLE)
                views.setViewVisibility(R.id.status, View.GONE)
            } else {
                views.setTextViewText(R.id.status, note ?: context.getString(R.string.widget_loading))
                views.setViewVisibility(R.id.image, View.GONE)
                views.setViewVisibility(R.id.status, View.VISIBLE)
            }
            val open = Intent(context, LauncherActivity::class.java)
                .setAction(Intent.ACTION_VIEW)
                .setData(Uri.parse(tapUrl(url, BuildConfig.VERSION_CODE)))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            views.setOnClickPendingIntent(
                R.id.root,
                PendingIntent.getActivity(context, id, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE),
            )
            manager.updateAppWidget(id, views)
        }

        // The space the launcher gives the widget, in dp, as it stands in portrait
        // (how phones are held). Android 12 and later name each orientation's size;
        // before that, portrait is the narrow width and the tall height.
        fun sizeDp(manager: AppWidgetManager, id: Int): Pair<Float, Float> {
            val o = manager.getAppWidgetOptions(id)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                @Suppress("DEPRECATION")
                val sizes = o.getParcelableArrayList<SizeF>(AppWidgetManager.OPTION_APPWIDGET_SIZES)
                val tallest = sizes?.filter { it.width > 0 && it.height > 0 }?.maxByOrNull { it.height / it.width }
                if (tallest != null) return tallest.width to tallest.height
            }
            val w = o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH)
            val h = o.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT)
            // Nothing known yet (a brand new widget on some launchers): a 4 x 2.
            return if (w > 0 && h > 0) w.toFloat() to h.toFloat() else 320f to 160f
        }
    }
}
