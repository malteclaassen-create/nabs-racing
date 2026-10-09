// Built-in content for the Help & troubleshooting page (/help). The live text
// is admin-editable (Admin -> Site texts -> Help, stored in the backend Setting
// table); this file is what shows while nothing is saved, and the "Reset to
// standard help" source in the editor.
//
// Text conventions (also explained in the editor):
//   **like this**       -> bold
//   [label](/path)      -> a link; a path stays on the site, https:// opens a new tab
//   a blank line        -> a new paragraph
//   {answers}           -> the sign-up answers that are switched on right now,
//                          e.g. "**Accepted** or **Declined**"
//
// Written for the questions that keep landing in tickets and in the briefing
// channel right before a race. Every answer should end with something to DO.
//
// The files themselves (tracks, skins, Custom Shaders Patch, Real Penalty,
// replays) live in the league's Google Drive folder, not in the site's own
// downloads, so the answers link there.
const DRIVE = "https://drive.google.com/drive/folders/17CYMeD0rBS4ASviTa2Rlz3PHnpEyiRMy";
export const HELP_DEFAULTS = {
  topics: [
    {
      title: "Getting on the server",
      items: [
        {
          q: "Where do I get the tracks, skins and mods?",
          a: `Everything is in the [NABS Google Drive](${DRIVE}): the tracks, the skins, Custom Shaders Patch, Real Penalty and the replays. Install them before race day, so you are not downloading while the briefing starts.`,
        },
        {
          q: "I get kicked with \"Checksum failed\"",
          a: `One of your files is not the same version as the server's, usually the car, the track or a skin pack. You don't have to guess which one: the [Content Check](/content-check) compares your Assetto Corsa folder with the race server and names the file that doesn't match. It runs in your browser, nothing gets uploaded.\n\nThen grab that file again from the [NABS Google Drive](${DRIVE}) and install it over the old one.`,
        },
        {
          q: "I get kicked straight after joining, or it says the server needs Real Penalty",
          a: `Real Penalty is **mandatory** on our servers. If the app isn't running when you join, the server removes you.\n\nInstall the Real Penalty version from the [NABS Google Drive](${DRIVE}), make sure the app is switched on in Content Manager, and check in-game that its window opens from the app bar on the right side of the screen.`,
        },
        {
          q: "Real Penalty is installed but still won't connect",
          a: "Open a ticket in Discord and attach your **py_log.txt**. You find it in Documents \\ Assetto Corsa \\ logs. That log shows the admins exactly where the connection stops, which is much faster than trying things one by one.",
        },
        {
          q: "I'm in the wrong car or the wrong livery",
          a: "Cars and liveries are given out by the server's entry list, so you can't change them yourself. Tell an admin in Discord which slot you got and which one you expected.",
        },
        {
          q: "The server says it's full",
          a: "Every race has a fixed number of seats. If the grid is full when you sign up, the button on the [Attendance](/attendance) page puts you on the **waiting list**. When someone declines, the first person on the list moves up automatically and gets a notification.",
        },
      ],
    },
    {
      title: "Race week",
      items: [
        {
          q: "How do I sign up for a race?",
          a: "On the [Attendance](/attendance) page, pick {answers} for the next round. Sign-up opens a few days before the race, and you can change your answer until then.",
        },
        {
          q: "I can't make it this week",
          a: "Mark yourself **Declined** on the [Attendance](/attendance) page as early as you can. There is no penalty for it, and it gives your seat to a reserve.",
        },
        {
          q: "Where do I need to be before the race?",
          a: "In the briefing voice channel on Discord, a few minutes before the start. The race time is on the [Races](/races) page and in the sign-up post.",
        },
        {
          q: "Where are the rules?",
          a: "Everything is on the [Race Info](/downloads) page: points, tyres, track limits, qualifying and the safety car procedure.",
        },
      ],
    },
    {
      title: "After the race",
      items: [
        {
          q: "How do I report an incident?",
          a: "Use **Stewarding** on the site: [Report an incident](/reports). Add the lap and the corner, and the stewards can jump straight to that moment in the replay. Only you and the stewards see your report.",
        },
        {
          q: "Why did my result change after the race?",
          a: "Penalties are added as **seconds on your race time** once the stewards are done, so positions can move after the race. The [Races](/races) page always shows the current classification.",
        },
        {
          q: "Where do I find the replay?",
          a: `All replays are in the [NABS Google Drive](${DRIVE}). You can also open the race on the [Races](/races) page: if a replay was uploaded there, a Replay button sits next to the result.`,
        },
      ],
    },
    {
      title: "The website",
      items: [
        {
          q: "How do I log in?",
          a: "With your Discord account, via the button at the top right. There is no separate password for this site.",
        },
        {
          q: "I logged in but my profile has no results",
          a: "Your Discord account isn't linked to your driver yet. An admin does that in a minute, just send a message in Discord with your driver name.",
        },
        {
          q: "Something on the site is broken",
          a: "Press the **Feedback** button (bottom right on a computer, in the menu on a phone) and describe what happened. The admins answer right there, you'll see the reply under Your messages.",
        },
      ],
    },
  ],
};
