package com.nabsracing.app

import com.google.androidbrowserhelper.trusted.LauncherActivity
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

// The app's front door opens without throwing, with this app's manifest
// settings (launch address, colours, splash screen). Robolectric runs the
// unshrunk code, so a fault that only R8 introduces is not caught here.
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class LaunchSmokeTest {
    @Test
    fun launcherStarts() {
        Robolectric.buildActivity(LauncherActivity::class.java).setup()
    }
}
