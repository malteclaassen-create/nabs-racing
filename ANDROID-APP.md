# The Android app (APK)

The NABS Racing app for Android phones, handed out as a download from the site
rather than through the Play Store. This guide is for the league admin. Most of
it is done once.

**What the app is.** Two things in one:

- **The website, full screen.** Open the app and nabsracing.com opens in the
  phone's browser with no address bar, with the browser's own login. Nothing of
  the site is copied into the app, so a change to the site is in the app at once.
- **Home screen widgets.** The same widgets as on the iPhone. The app does not
  have its own copy of them: it opens the site's widget page
  (`frontend/public/widget-preview/android.html`) in a hidden browser the size
  of the widget, takes a picture of it, and puts that on the home screen. The
  page runs the iPhone widgets' own code (`nabs-core.js`), so a new widget
  version reaches Android phones with their next refresh, without a new app.

**Where things are.**

| What                     | Where                                                   |
| ------------------------ | ------------------------------------------------------- |
| The app's code           | `android/`                                              |
| Its version              | `android/release.json`                                  |
| The download link        | <https://nabsracing.com/android.apk>                    |
| The releases             | GitHub, under Releases (`android-v1.0`, ...)            |
| The build                | GitHub Actions, workflow "Android app"                  |
| How members install it   | My Profile -> Widgets -> Android                        |

---

## Once: the signing key

Every APK is signed with a key. Android only installs an update over an app
that was signed with the **same** key. Lose the key and nobody can update the
app any more: everyone would have to uninstall it and install a new one.

The key was made once and handed over as a file, `nabs-racing.keystore`, with
its password. Before anything else:

1. Put the keystore file and the password in your password manager (or your
   cloud storage), **and** a second copy somewhere else.
2. Tell somebody else in the league admin team where it is.

### Give the key to GitHub

GitHub builds the app, so it needs the key. It gets it as two **secrets**: values
GitHub keeps hidden, even from people who can read the repository.

1. Open the repository on GitHub -> **Settings** -> **Secrets and variables** ->
   **Actions** -> **New repository secret**.
2. Name: `ANDROID_KEYSTORE_BASE64`. Value: the whole text of the file
   `nabs-racing.keystore.base64.txt` (the keystore written out as text).
   **Add secret.**
3. Again **New repository secret**. Name: `ANDROID_KEYSTORE_PASSWORD`. Value:
   the password. **Add secret.**
4. Go to **Actions** -> **Android app** -> **Run workflow** (on `main`). After
   a few minutes there is a release `android-v1.0` under **Releases**, and
   <https://nabsracing.com/android.apk> downloads it.

Without the secrets the build still runs (so a pull request can be checked),
but it publishes nothing.

### Tell the site about the app

The app hides the browser's address bar only if the site vouches for it.

1. League office -> **Site & system -> Site texts -> Privacy & app**.
2. **Package name**: `com.nabsracing.app`
3. **SHA-256 signing fingerprints**:
   `6F:3F:64:8C:6D:EE:17:5E:72:22:41:8D:74:9E:CA:3E:50:B8:4B:84:61:AF:20:A9:43:4C:ED:94:AF:40:3A:38`
4. **Save.** <https://nabsracing.com/.well-known/assetlinks.json> now shows
   both.

If the app opens with a thin address bar across the top, this step is missing
or the fingerprint does not match.

---

## Installing it (what members do)

Members find this under **My Profile -> Widgets -> Android** (once that page is switched
on for everyone; until then only admins see it):

1. Open <https://nabsracing.com/android.apk> on the phone. Android asks once
   whether the browser may install apps: allow it for this one.
2. Open the app.
3. To add a widget: press and hold an empty spot on the home screen ->
   **Widgets** -> **NABS Racing**, and drag it onto the screen. A screen opens
   to pick what it shows, the series and the driver name, with a live preview.
   Pressing and holding the widget later -> the pencil (or **Widget settings**)
   changes it again.

A widget can be resized like any other: it then switches between the iPhone's
small, medium and large layout. Tapping it opens the matching page in the app.

**How often they refresh.** As often as the widget itself asks, the same as on
the iPhone: every few minutes on a race night, every couple of hours in a quiet
week. Android may run a refresh a little later than asked to save battery. With
no connection the widget keeps its last picture and tries again later.

---

## Publishing a new version of the app

Only needed when something in `android/` changes. A change to the site, or to the
widgets' look (`nabs-core.js`), needs no new app.

1. In the same pull request as the change, raise both numbers in
   `android/release.json`: `versionCode` by one (1 -> 2), `versionName` to
   match (`"1.0"` -> `"1.1"`).
2. Merge. The workflow builds the APK and makes the release `android-v1.1`.
3. Apps on phones notice: the site shows "A new version of the NABS app is
   out" inside the app, with a button to get it. Installing it over the old
   one keeps the widgets.

If the version is not raised, the build runs but publishes nothing (the
release for that version already exists).

**Trying a build before it is released.** Every run of the workflow, also for a
pull request, keeps its APK for two weeks: Actions -> the run -> **Artifacts**
-> `nabs-racing-apk` (a zip with the APK inside).

---

## Later: the Play Store

`PLAY-STORE.md` describes publishing the app in the Play Store. The app no
longer has to be made at pwabuilder.com for that: it is this one. Two things to
keep in mind:

- Use the **same key**. When Play Console asks how the app is signed (**Play
  App Signing**), choose to **use your own key** and upload this keystore
  (Play Console explains the export step). Then the Play Store version installs
  over the APK, and members do not have to uninstall anything.
- Play Console wants an `.aab` file rather than an APK: run
  `./gradlew bundleRelease` in `android/` with the same two settings the
  workflow uses (or ask for it to be added to the workflow).
