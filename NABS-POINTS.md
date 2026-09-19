# NABS Points - the admin's guide

NABS Points are the league's own currency. Members earn them by racing and by
bringing people in, and spend them in a shop on the site (card designs, profile
designs, a helmet, a Discord role, a name on the Hall of Fame wall). Everything
is switched from the admin area, nothing needs a code change.

This page is for whoever runs it. Ten minutes to read.

## 1. Switching it on

Admin -> Community -> NABS Points. The card at the top has three settings:

| Setting | What happens |
| --- | --- |
| **Off** | Nobody sees anything. Balances are kept. |
| **Admins only** | League admins see the balance in the nav bar, the shop and the profile studio and can try everything. Members see nothing, and nothing shows on public pages. Use this to test on the live site. |
| **Everyone** | The real thing. Members see their balance, the shop, the invite link. Profile designs and the wall are public. |

Under it is a second switch, **Earning points**, and it is a separate decision.
Who sees the feature and whether anything is being counted are two different
things, so you can put the whole thing in front of the grid, let people look at
the shop, and start the counting on a day you pick.

While it says Paused: no race pays, no balance moves, and the members' page
says so at the top. Buying still works, and so does anything you book by hand.

The first time you press **Start counting**, that day becomes the **start day**:
races before it pay nothing (the league decided to start from zero). You can
move the date under "Rules and prices", empty means every race ever.

Recommended order: Admins only for a week or two, set the prices, switch to
Everyone with the counting still paused, then start the counting when the
league is ready.

## 2. What earns points

Set under "Rules and prices". Defaults come from the league's sheet:

- finish a race: 50
- finish it without a penalty: 20 on top, paid on the Tuesday after the round (that's when the stewards are done)
- somebody signs up through your invite link or your Discord invite: 50
- that person finishes a race: 30, for their first 12 races

Racing points are multiplied by Discord activity (chat messages and voice time
over the last 7 days), up to 3x. A week, not a month, so the multiplier says
what somebody has been doing lately and falls back on its own when they go
quiet. The "who is ahead" board on the members' page is a different question and
still looks back 30 days. That needs the Discord bot, see 5. Without it
everybody is on 1.0x, which is fine.

Every number on that page is editable. Empty field = the default. Numbers raised
pay out backwards (a race already driven gets the difference), numbers lowered
leave what was paid.

**When a race is paid:** the moment you import or save the result. The
multiplier moves every day, so what the round pays is decided that night and
written down per driver. Correcting a penalty and saving again does not change
what the round was worth and does not pay anybody twice. The clean-race bonus
still waits for the Tuesday, but at the rate from the night of the race.

## 3. The shop

Also under "Rules and prices": price per item, and a "for sale" tick to hide one
without deleting it. Card designs are priced per series, profile studio designs
per type.

Two kinds of items:

- **Filled by the site**: card designs, profile designs, profile flair, hall of
  fame entry. The member pays and has it immediately. Nothing to do.
- **Filled by a person**: custom helmet, Discord role. These land under
  "Orders". Someone from the league office does the thing, then clicks "Mark
  filled" (with a line for the member if you like) or "Decline and refund".

"Balances" lists everyone with a balance and lets you add or take points by
hand, with a reason. Members see that reason in their history.

## 4. Members' side, so you know what they see

- Nav bar: avatar and points in one capsule, with a "+50" animation the first
  time they look after a race.
- Profile -> NABS Points tab: balance, activity multiplier, invite link, shop,
  orders, leaderboard, the rules.
- Profile studio (from the shop): themes, banners, name lettering, stats styles
  and effects for their public profile page, tried live before buying.
- Hall of Fame page: "The wall" with everybody who bought a wall entry.

## 5. The Discord bot

Optional but worth it. It counts messages and voice minutes (for the
multiplier) and notices who invited whom on Discord, so referrals work without
a link.

Setup is in `discord-bot/README.md`. Short version: create a bot in the Discord
developer portal, put it on the server with Manage Server and View Channels,
copy the key from Admin -> NABS Points -> Discord bot into the bot's `.env`,
run it. The bot can run before the points are switched on, then the 30-day
window is already full on day one.

Voice minutes only count for someone actually there: not muted, not deafened,
not alone in the channel, not parked in the AFK one. Otherwise leaving Discord
open overnight buys the whole multiplier. Three switches in the bot's `.env` if
the league wants it looser.

## 6. If something looks wrong

- A member sees no points tab: the setting is Off, or Admins only and they are
  not an admin, or they are not signed in with Discord.
- Nobody earns anything: Earning points is Paused. Press Start counting.
- Somebody's races don't pay: they are before the start day, or the rule is
  switched off, or the race isn't marked completed yet.
- A design vanished from someone's profile: the purchase was declined
  (refunded) under Orders. That's by design.
- Clean-race bonus missing on Monday: it pays Tuesday 9:00, after stewarding.
- The bot says "Bad key": copy the key again from the admin.

All of this lives in the code under `backend/src/lib/tokens.js` (rules, shop),
`backend/src/lib/tokenRules.js` (the maths) and `backend/src/lib/profileStudio.js`
(the studio), if a developer ever needs to look.
