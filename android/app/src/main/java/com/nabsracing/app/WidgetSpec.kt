package com.nabsracing.app

import java.net.URLEncoder
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

// What one widget on the home screen is, and the arithmetic that turns the space
// Android gives it into an iPhone widget layout. No Android classes in here, so
// the unit tests can run it as is (WidgetSpecTest).

const val BASE_URL = "https://nabsracing.com"

// The widgets the iPhone setup offers, in its order (const WIDGETS in
// frontend/public/widgets/nabs-setup.js). `driver` marks the ones that are about
// one driver and say nothing useful without a name.
data class WidgetKind(val view: String, val name: String, val blurb: String, val driver: Boolean = false)

val WIDGET_KINDS = listOf(
    WidgetKind("auto", "Auto", "The latest result after a race, the next race before one."),
    WidgetKind("result", "Latest Race", "The last race: winner, podium and your own result."),
    WidgetKind("next", "Next Race", "The next race with the countdown and the table."),
    WidgetKind("countdown", "Countdown", "Days and hours until lights out."),
    WidgetKind("live", "Live Timing", "The session's fastest laps while the server is running."),
    WidgetKind("standings", "Standings", "The driver standings with your row highlighted."),
    WidgetKind("top3", "Top 3", "The podium of the championship, and where you are."),
    WidgetKind("constructors", "Constructors", "The constructors table of your tier, with your team."),
    WidgetKind("card", "Driver Card", "Your driver card with your rating.", driver = true),
    WidgetKind("me", "My Season", "Your season: position, points, and the drivers around you.", driver = true),
    WidgetKind("teammate", "Teammate", "You against your teammate, head to head.", driver = true),
    WidgetKind("signup", "Sign-up", "Are you signed up, and how many seats are left."),
    WidgetKind("attendance", "Attendance", "How many races you drove this season.", driver = true),
    WidgetKind("form", "Form", "Your last six results at a glance.", driver = true),
    WidgetKind("rivals", "Rivals", "The driver ahead of you and the one behind, in points.", driver = true),
)

// The two leagues, as on the profile's widget page. "" is the main series.
data class Series(val slug: String, val label: String)

val SERIES = listOf(
    Series("", "F1 Friday"),
    Series("sunday-championship", "Sunday Championship"),
)

// What the iPhone setup saves (nabs-settings.json), per widget here.
data class WidgetConfig(
    val view: String = "auto",
    val series: String = "",
    val driver: String = "",
    val tierOnly: Boolean = false,
)

// The iPhone layout to draw and its size in iPhone points.
data class Layout(val family: String, val width: Int, val height: Int)

// A layout and the pixels to draw it in.
data class Frame(val layout: Layout, val widthPx: Int, val heightPx: Int)

// The iPhone 15 / 16's widget sizes, the screen android.js tells the core about.
private val BASE = mapOf(
    "small" to (158 to 158),
    "medium" to (338 to 158),
    "large" to (338 to 354),
)

// Which layout suits a space of this shape (in dp), and how tall to make it.
//
// The width is always the iPhone's: the core works its columns out for exactly
// that width. The height follows the shape of the space, so the picture fills it,
// but never below the iPhone's own height: the layouts are full to the brim at that
// height, and one pressed flatter runs off its top and bottom edges (the large "My
// Season" lost the top of its picture at 85 %). A box flatter than the layout gets a
// margin at the sides instead (the ImageView fits the picture in). Taller is fine up
// to a point, where the space inside a layout just grows.
fun layoutFor(widthDp: Float, heightDp: Float): Layout {
    val w = max(widthDp, 1f)
    val h = max(heightDp, 1f)
    val ratio = w / h
    val family = when {
        ratio >= 1.6f -> "medium"
        min(w, h) >= 250f -> "large"
        else -> "small"
    }
    val (bw, bh) = BASE.getValue(family)
    val height = (bw / ratio).roundToInt().coerceIn(bh, (bh * 1.35f).roundToInt())
    return Layout(family, bw, height)
}

// The pixels for a layout in a space of this many pixels: as large as fits, keeping
// the layout's shape, and no larger than maxPixels in all (a widget picture travels
// to the launcher in one piece, and Android limits how big that may be).
fun frameFor(widthDp: Float, heightDp: Float, density: Float, maxPixels: Int = MAX_PIXELS): Frame {
    val layout = layoutFor(widthDp, heightDp)
    val boxW = max(widthDp * density, 1f)
    val boxH = max(heightDp * density, 1f)
    var scale = min(boxW / layout.width, boxH / layout.height)
    val pixels = layout.width * layout.height * scale * scale
    if (pixels > maxPixels) scale *= kotlin.math.sqrt(maxPixels / pixels)
    return Frame(layout, max(1, (layout.width * scale).roundToInt()), max(1, (layout.height * scale).roundToInt()))
}

// About 3.5 MB of picture: room for a large widget at a sharp resolution, and far
// below what launchers accept.
const val MAX_PIXELS = 900_000

// The page that draws it (frontend/public/widget-preview/android.js).
fun renderUrl(config: WidgetConfig, layout: Layout): String {
    val q = linkedMapOf(
        "view" to config.view,
        "family" to layout.family,
        "w" to layout.width.toString(),
        "h" to layout.height.toString(),
    )
    if (config.driver.isNotBlank()) q["driver"] = config.driver.trim()
    if (config.series.isNotBlank()) q["series"] = config.series
    if (config.tierOnly && config.driver.isNotBlank()) q["scope"] = "tier"
    return "$BASE_URL/widget-preview/android.html?" + q.entries.joinToString("&") { (k, v) ->
        k + "=" + URLEncoder.encode(v, "UTF-8").replace("+", "%20")
    }
}

// When to draw again, from what the widget asked for (refreshAfterDate). Never
// sooner than five minutes, which is what the core asks for on a race night at
// most, and never later than three hours, so a day without races still moves on.
fun nextRefresh(now: Long, asked: Long?): Long {
    val earliest = now + 5 * 60_000L
    val latest = now + 3 * 3_600_000L
    return (asked ?: latest).coerceIn(earliest, latest)
}

// The page a tap opens, marked as coming from the app (the site then knows to
// offer the app's own updates, see AndroidAppNotice on the site).
fun tapUrl(url: String?, versionCode: Int): String {
    val base = if (url != null && url.startsWith("$BASE_URL/")) url else "$BASE_URL/"
    val hash = base.indexOf('#')
    val (path, fragment) = if (hash >= 0) base.substring(0, hash) to base.substring(hash) else base to ""
    val sep = if (path.contains('?')) "&" else "?"
    return "$path${sep}app=android&appv=$versionCode$fragment"
}
