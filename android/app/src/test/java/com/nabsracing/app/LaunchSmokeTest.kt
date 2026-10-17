package com.nabsracing.app

import android.content.ComponentName
import android.content.Intent
import android.widget.ScrollView
import com.google.androidbrowserhelper.trusted.LauncherActivity
import com.google.androidbrowserhelper.trusted.ManageDataLauncherActivity
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

// The app's front door opens without throwing, with this app's manifest
// settings (launch address, colours, splash screen). Robolectric runs the
// unshrunk code, so a fault that only R8 introduces is not caught here. Nor is
// what the launcher does only when a real browser is installed, which is why the
// activities it needs then are checked by name below.
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class LaunchSmokeTest {
    @Test
    fun launcherStarts() {
        Robolectric.buildActivity(LauncherActivity::class.java).setup()
    }

    // On a phone with Chrome, every start switches on the site settings entry
    // (ManageDataLauncherActivity.addSiteSettingsShortcut). Without it in the
    // manifest the app crashed on first launch, on a Samsung with Android 16.
    @Test
    fun theActivitiesTheLauncherSwitchesOnAreDeclared() {
        val context = Robolectric.buildActivity(LauncherActivity::class.java).get()
        context.packageManager.getActivityInfo(ComponentName(context, ManageDataLauncherActivity::class.java), 0)
    }

    // The screen that shows a crash must not be the thing that crashes.
    @Test
    fun crashScreenShowsTheError() {
        val intent = Intent().putExtra(CrashActivity.EXTRA_TRACE, "java.lang.IllegalStateException: boom")
        val activity = Robolectric.buildActivity(CrashActivity::class.java, intent).setup().get()
        val root = activity.window.decorView.findViewById<android.view.ViewGroup>(android.R.id.content).getChildAt(0)
        assertTrue(root is ScrollView)
    }
}
