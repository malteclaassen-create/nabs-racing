package com.nabsracing.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class WidgetSpecTest {

    @Test
    fun aWideBoxGetsTheMediumLayout() {
        // A 4 x 2 widget on a Pixel
        val l = layoutFor(360f, 190f)
        assertEquals("medium", l.family)
        assertEquals(338, l.width)
        assertEquals(178, l.height)
    }

    @Test
    fun aSmallSquareGetsTheSmallLayout() {
        val l = layoutFor(170f, 190f)
        assertEquals("small", l.family)
        assertEquals(158, l.width)
        assertEquals(177, l.height)
    }

    @Test
    fun aBigBoxGetsTheLargeLayout() {
        val l = layoutFor(360f, 420f)
        assertEquals("large", l.family)
        assertEquals(338, l.width)
        assertEquals(394, l.height)
    }

    @Test
    fun theHeightStopsWhereTheLayoutWouldBendOutOfShape() {
        // A 4 x 1 strip: far flatter than the medium widget
        assertEquals(158, layoutFor(360f, 80f).height)
        // 3 x 2: too narrow for medium, too small for large
        val l = layoutFor(260f, 190f)
        assertEquals("small", l.family)
        assertEquals(158, l.height)
        // very tall
        assertEquals(213, layoutFor(120f, 400f).height)
    }

    @Test
    fun aLayoutIsNeverPressedBelowTheIphonesHeight() {
        // The space that cut the top off "My Season" on a Samsung: a bit flatter
        // than the large widget
        val l = layoutFor(360f, 320f)
        assertEquals("large", l.family)
        assertEquals(354, l.height)
        for ((w, h) in listOf(400f to 120f, 300f to 280f, 140f to 120f)) {
            val x = layoutFor(w, h)
            val iphone = mapOf("small" to 158, "medium" to 158, "large" to 354).getValue(x.family)
            assertTrue("${x.family} at $w x $h", x.height >= iphone)
        }
    }

    @Test
    fun theFrameFillsTheBoxAtTheScreensDensity() {
        val f = frameFor(360f, 190f, 2.75f)
        assertEquals("medium", f.layout.family)
        // the box is 990 x 522.5 px; the layout's shape fits it by its width
        assertEquals(990, f.widthPx)
        assertEquals(521, f.heightPx)
    }

    @Test
    fun aHugeFrameIsScaledDownToTheLimit() {
        val f = frameFor(400f, 440f, 4f)
        assertTrue(f.widthPx.toLong() * f.heightPx <= MAX_PIXELS + 2_000)
        // keeps the layout's shape
        val ratio = f.widthPx.toFloat() / f.heightPx
        assertEquals(f.layout.width.toFloat() / f.layout.height, ratio, 0.01f)
    }

    @Test
    fun theRenderUrlCarriesTheSettings() {
        val url = renderUrl(WidgetConfig("me", "sunday-championship", "Max Power", true), Layout("small", 158, 160))
        assertEquals(
            "https://nabsracing.com/widget-preview/android.html?view=me&family=small&w=158&h=160" +
                "&driver=Max%20Power&series=sunday-championship&scope=tier&live=1",
            url,
        )
    }

    @Test
    fun noTierWithoutADriver() {
        val url = renderUrl(WidgetConfig("standings", tierOnly = true), Layout("medium", 338, 158))
        assertEquals("https://nabsracing.com/widget-preview/android.html?view=standings&family=medium&w=338&h=158&live=1", url)
    }

    @Test
    fun thePreviewKeepsItsClocksInThePage() {
        val url = renderUrl(WidgetConfig("countdown"), Layout("small", 158, 158), liveTimers = false)
        assertEquals("https://nabsracing.com/widget-preview/android.html?view=countdown&family=small&w=158&h=158", url)
    }

    @Test
    fun aClockGoesWhereItWasInThePicture() {
        // "Lights out in" on a medium widget: the bottom left of the picture
        val t = LiveTimer(0, x = 0.04f, y = 0.78f, w = 0.6f, h = 0.14f, size = 0.056f, color = "#F4AFC6", align = "left")
        // The picture fills a widget of its own size exactly
        val same = placeTimer(t, 990f, 470f, 990, 470)
        assertEquals(40, same.left)
        assertEquals(367, same.top)
        assertEquals(990 - 40 - 594, same.right)
        assertEquals(38, same.bottom) // 470 - (366.6 + 65.8)
        assertEquals(55.4f, same.textPx, 0.1f)
        // A wider widget: the picture is centred, the clock moves with it
        val wide = placeTimer(t, 1090f, 470f, 990, 470)
        assertEquals(90, wide.left)
        assertEquals(367, wide.top)
        // A picture smaller than the widget is scaled up, and the clock with it
        val scaled = placeTimer(t, 1980f, 940f, 990, 470)
        assertEquals(79, scaled.left)
        assertEquals(110.9f, scaled.textPx, 0.1f)
    }

    @Test
    fun theWidgetIsDrawnAgainWhenAClockReachesZero() {
        val now = 1_000_000_000L
        // lights out in 20 minutes, the widget itself asked for 2 hours
        assertEquals(now + 20 * 60_000L + 15_000L, nextRefresh(now, now + 2 * 3_600_000L, now + 20 * 60_000L))
        // in 30 seconds: too close to book, the usual five minutes stand
        assertEquals(now + 5 * 60_000L, nextRefresh(now, now + 60_000L, now + 30_000L))
        // in six hours: later than what the widget asked for anyway
        assertEquals(now + 2 * 3_600_000L, nextRefresh(now, now + 2 * 3_600_000L, now + 6 * 3_600_000L))
    }

    @Test
    fun refreshesStayBetweenFiveMinutesAndThreeHours() {
        val now = 1_000_000_000L
        assertEquals(now + 5 * 60_000L, nextRefresh(now, now + 1_000))
        assertEquals(now + 10 * 60_000L, nextRefresh(now, now + 10 * 60_000L))
        assertEquals(now + 3 * 3_600_000L, nextRefresh(now, now + 24 * 3_600_000L))
        assertEquals(now + 3 * 3_600_000L, nextRefresh(now, null))
    }

    @Test
    fun tapsOpenTheSiteMarkedAsTheApp() {
        assertEquals("https://nabsracing.com/s/friday-f1/races?app=android&appv=3", tapUrl("https://nabsracing.com/s/friday-f1/races", 3))
        assertEquals("https://nabsracing.com/x?a=1&app=android&appv=3#top", tapUrl("https://nabsracing.com/x?a=1#top", 3))
        assertEquals("https://nabsracing.com/?app=android&appv=3", tapUrl(null, 3))
        // only ever the league's own site
        assertEquals("https://nabsracing.com/?app=android&appv=3", tapUrl("https://example.com/", 3))
        assertEquals("https://nabsracing.com/?app=android&appv=3", tapUrl("https://nabsracing.com.example.com/x", 3))
        // the core's own fallback, the bare domain
        assertEquals("https://nabsracing.com/?app=android&appv=3", tapUrl("https://nabsracing.com", 3))
    }

    @Test
    fun everyViewHasAName() {
        assertEquals(15, WIDGET_KINDS.size)
        assertEquals(WIDGET_KINDS.size, WIDGET_KINDS.map { it.view }.toSet().size)
    }
}
