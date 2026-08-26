# Putting the site in the Google Play Store - step by step

This guide is for the league admin who wants the NABS Racing website to
appear as an Android app in the Google Play Store. You do not need to know
anything about programming, and nobody has to build a second version of the
site.

**What the app actually is.** It is this website, running full screen, with
no address bar. Android calls that a Trusted Web Activity. There is no
separate app to maintain: when the website changes, the app changes with it,
because it IS the website. Members who install it get an icon on their home
screen, the same login, the same everything.

**What it costs.** $25 to Google, once, ever. Nothing after that.

**How long it takes.** Three to four weeks, of which maybe three hours is
actual work. The rest is waiting: Google verifies who you are, and then
insists the app is tested for 14 days before it may go public.

**Before you start, the website side is already done.** The privacy policy,
the account deletion page, the offline behaviour and the file that links the
app to the domain are built and live. You will only be filling things in.

---

## What you need before you start

- A **Google account** (a normal Gmail account is fine).
- **$25** on a credit card, once.
- A **photo ID** (passport or driving licence) and your address. Google
  verifies every new developer.
- **Admin access to the website** (the same login you use for the league
  office).
- **12 people** who will install a test version and leave it on their phone
  for two weeks. League members with Android phones. Start asking now, this
  is the part that takes longest.
- About **3 hours** of your own time, spread over those weeks.

---

## Step 0 - Fill in the privacy contact first

The website's privacy page currently says the contact is still being
settled. Google will not publish an app whose privacy policy has no
responsible person on it.

1. Sign in to the website, open the **league office** (Admin).
2. Go to **Site content -> Privacy & app**.
3. Fill in **Name** and **Email for privacy requests**. A postal address is
   optional.
4. Press **Save**, then open <https://nabsracing.com/privacy> and check that
   your details appear at the top.

Do this before anything else. It takes two minutes and everything later
depends on it.

---

## Step 1 - Google Play developer account

1. Go to <https://play.google.com/console> and sign in with your Google
   account.
2. Choose **Create a developer account**. When it asks what kind:
   - **Personal** is simplest, but comes with the 14-day test requirement in
     Step 7.
   - **Organisation** avoids that requirement, but needs a D-U-N-S number for
     the club, which takes weeks to obtain. Only worth it if the league is a
     registered club and already has one.
   - If in doubt, choose **Personal**.
3. Pay the **$25**.
4. Complete the **identity verification**: upload your ID, confirm your
   address and phone number.
5. Wait. This usually takes one to three days. You will get an email.

Nothing else can happen until this is approved, so do it first and do the
rest while you wait.

---

## Step 2 - Create the app entry

Once your account is approved:

1. In Play Console, click **Create app**.
2. **App name**: what members will see under the icon. Max 30 characters.
   "NABS Racing" is the obvious choice. You can change this later.
3. **Default language**: English.
4. **App or game**: App. **Free or paid**: Free (this cannot be changed to
   paid later).
5. Tick the declarations at the bottom and create it.

The app now exists in your account. Nothing is public yet, and nothing will
be until you deliberately publish it in Step 8.

---

## Step 3 - Tell the website what the app is called

1. Back in the league office: **Site content -> Privacy & app**.
2. Fill in **App name** with exactly the name you just chose.
3. **Save.**

Why this matters: Google requires the privacy policy to mention the app by
name, not just the website. The page now does.

---

## Step 4 - Build the app file

This is the part that sounds technical and is not. A free Microsoft service
does it for you.

1. Go to <https://www.pwabuilder.com>.
2. Type in **https://nabsracing.com** and press Start.
3. It checks the site and shows a report. It should pass: the site has the
   manifest, the icons and the offline behaviour it looks for.
4. Click **Package for stores**, then **Android**.
5. Check the settings it offers:
   - **Package ID**: something like `com.nabsracing.app`. **Choose carefully:
     this can never be changed.** If you ever delete the app and start again,
     the old ID is burned for good.
   - **App name**: the same name as in Step 2.
   - **Signing key**: choose **Create new**.
6. Download the zip.

**The zip contains something irreplaceable.** Inside are the app file
(`.aab`), a signing key (`.keystore`) and a text file with its passwords.
Lose the key and you can never publish an update to this app again, ever.
Not "it is difficult", it is impossible.

So, right now, before you go on:

- Put the whole zip in your cloud storage (Google Drive, Dropbox, whatever
  you actually use).
- Put a second copy somewhere else. A USB stick in a drawer is fine.
- Tell Malte you have it, so somebody else knows it exists.

---

## Step 5 - Link the app to the website

The app is allowed to hide the browser's address bar only if the website
vouches for it. That happens through two values from the zip you just
downloaded.

1. Look inside the zip for a file called `assetlinks.json`. Open it in any
   text editor. It contains a **package name** and a long **fingerprint**
   that looks like `AB:CD:EF:12:...`, 32 pairs long. If the zip has no such
   file, the same fingerprint is in `signing-key-info.txt`, and the readme
   in the zip points at it too.
2. In the league office: **Site content -> Privacy & app**.
3. Put the package name in **Package name**.
4. Put the fingerprints in **SHA-256 signing fingerprints**, one per line.
   Pasting them with or without the colons both work.
5. **Save.** A green line should appear saying the domain is vouching for
   your app.
6. Click **Check the file** in that green line, or open
   <https://nabsracing.com/.well-known/assetlinks.json>. You should see the
   values you just entered.

**Come back to this step after Step 8.** Google re-signs your app with its
own key, which produces a SECOND fingerprint. You find it in Play Console
under **App integrity** (use the search box at the top of Play Console if
the menu has moved), on the app signing page, listed as the **app signing
key certificate** SHA-256. Add that one to the box as well, on its own line.
If you skip this, the published app shows an address bar across the top even
though your own test version did not.

---

## Step 6 - Fill in the store listing

In Play Console, under **Grow -> Store presence -> Main store listing**:

- **Short description** (max 80 characters). For example:
  `Results, standings and live timing for the NABS Racing League.`
- **Full description** (max 4000). Describe the league in your own words:
  what it races, how often, what the site does (standings, results, live
  timing, sign-ups, downloads). Write it for somebody who has never heard of
  you.
- **App icon**: 512x512 PNG. Ask Malte, the site already has one.
- **Feature graphic**: 1024x500 PNG. This is the banner at the top of the
  store page. Ask Malte.
- **Phone screenshots**: at least two, at most eight. Open the site on your
  phone, screenshot the standings, a race result, the live timing page and
  a driver profile. Those four tell the story.
- **App category**: Sports.
- **Contact details**: an email address that you read.

---

## Step 7 - App content (the questionnaires)

Under **Policy -> App content**. This is the part that gets applications
rejected, because the answers have to match what the privacy policy says.
The answers below are correct for the site as it is today. If the site later
starts doing something new with data, they have to be revisited.

### Privacy policy

`https://nabsracing.com/privacy`

### Data safety

The app is the website, so anything the website collects counts as the app
collecting it.

Answer the opening questions:

| Question                                                   | Answer                                   |
| ---------------------------------------------------------- | ---------------------------------------- |
| Does your app collect or share any of the required user data types? | **Yes**                          |
| Is all of the user data collected by your app encrypted in transit?  | **Yes**                          |
| Do you provide a way for users to request that their data is deleted? | **Yes**, `https://nabsracing.com/delete-account` |

Then tick these data types, and nothing else:

| Data type                                    | Collected | Shared | Optional?                       | Purpose                              |
| -------------------------------------------- | --------- | ------ | ------------------------------- | ------------------------------------ |
| Personal info -> Name                        | Yes       | No     | Optional (only if you sign in)  | App functionality, Account management |
| Personal info -> User IDs                    | Yes       | No     | Optional (only if you sign in)  | App functionality, Account management |
| Photos and videos -> Photos                  | Yes       | No     | Optional (only if you upload one) | App functionality                   |
| Messages -> Other in-app messages            | Yes       | No     | Optional                        | App functionality, Customer support   |
| App activity -> App interactions             | Yes       | No     | Not optional                    | Analytics                             |
| App info and performance -> Other app performance data | Yes | No  | Optional (only when reporting a bug) | Customer support                 |

Everything else stays unticked. In particular: **no** location, **no**
financial info, **no** contacts, **no** health data, **no** advertising or
device IDs, and **nothing is shared** with third parties.

If a question asks whether data is "processed ephemerally", answer **no**
for all of the above: they are stored.

Notes if a reviewer or a form asks for more detail:

- Name and User IDs come from signing in with Discord. The site receives a
  Discord ID, username and display name, and nothing else. No email address.
- App interactions is the site's own page counter. It stores page views and
  a one-way fingerprint that changes daily. No cookies, no analytics
  service, and the visitor's address is never stored.

### Content rating

Fill in the questionnaire honestly. For this site:

- Violence, sexual content, drugs, gambling, crude humour: **no** to all.
- **Users can interact / share content: yes.** Members write messages to the
  admins and to each other in incident reports. Do not hide this, it is the
  one question where a wrong answer counts as a false declaration.
- Shares location: **no**.
- Digital purchases: **no**.

The result will be something like PEGI 3 with a "users interact" note.

### Target audience

- Age groups: **13 and up** (or 16 and up). **Do not tick under 13.** Ticking
  it puts the app under Google's rules for children's apps, which is a much
  heavier set of requirements and is not what this is.
- Appeals to children: **no**.

### Other declarations

| Question           | Answer                                        |
| ------------------ | --------------------------------------------- |
| Ads                | No, the app contains no ads                   |
| News app           | No                                            |
| Government app     | No                                            |
| Financial features | No                                            |
| Health apps        | No                                            |
| Data deletion      | Yes, users can request it in the app and at the URL above |

---

## Step 8 - The closed test (the 14 days)

If you created a Personal developer account, Google requires the app to run
a closed test with at least **12 testers** for **14 continuous days** before
you may apply to publish it.

1. In Play Console: **Test and release -> Testing -> Closed testing**.
2. Create a track, upload the `.aab` file from the zip.
3. Add your 12 testers by their **Gmail addresses**. It must be the address
   attached to the Google account on their phone.
4. Send them the opt-in link Play Console gives you. Each of them has to open
   it, accept, and install the app.
5. Now do the counting properly: the 14 days only run while at least 12
   testers are opted in. If somebody opts out on day 9, the clock has a
   problem. Get 14 or 15 people signed up so a couple of drop-outs do not
   cost you a fortnight.
6. While waiting, go back to **Step 5** and add Google's own signing
   fingerprint.

Ask your testers to actually open it a few times and tell you if anything
looks wrong. An address bar across the top means Step 5 is not finished.

---

## Step 9 - Publish

1. In Play Console: **Test and release -> Production**.
2. Create a release, upload the same `.aab`.
3. Write a short "what's new" line.
4. Send it for review.

Google's review usually takes a few days, sometimes longer for a brand new
developer account. If it is rejected, the email says which policy and you
fix that one thing and resubmit. A rejection is not the end of anything.

---

## After it is published

**You do not have to update the app when the website changes.** The app
shows the live site, so a new feature on the website is in the app the
moment it is deployed. Members do not have to update anything.

You only need to build and upload a new `.aab` when:

- Google raises the minimum Android version it accepts, which happens about
  once a year and comes with an email months in advance. Then: rebuild at
  pwabuilder.com with the SAME package ID and the SAME signing key from your
  zip, and upload it.
- You change the app's name or icon.

**Two things would break the app:**

- **Losing the signing key.** Covered above. Keep the zip.
- **Changing the website's domain.** The app is tied to
  `nabsracing.com`. If the site ever moves to a different address, the link
  has to be set up again for the new one. Moving the site to a different
  hosting account is fine, as long as the domain stays.

**If members report an address bar at the top of the app**, the domain link
is not verified. Check <https://nabsracing.com/.well-known/assetlinks.json>
and make sure Google's own fingerprint from Step 5 is in there.

---

## Quick reference

| What                        | Where                                                    |
| --------------------------- | -------------------------------------------------------- |
| Privacy policy URL          | `https://nabsracing.com/privacy`                          |
| Account deletion URL        | `https://nabsracing.com/delete-account`                   |
| Domain verification file    | `https://nabsracing.com/.well-known/assetlinks.json`      |
| Where you enter app details | League office -> Site content -> Privacy & app            |
| Where the app is built      | <https://www.pwabuilder.com>                              |
| Play Console                | <https://play.google.com/console>                         |
