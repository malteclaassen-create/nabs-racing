import { useCallback } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "../components/ui.jsx";
import { useSocial } from "../components/SocialLinks.jsx";
import { useSpecificTitle } from "../utils/pageTitle.js";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";

// ---------------------------------------------------------------------------
// /privacy — what the site stores, and what it doesn't.
//
// Written because a league site that carries Discord logins, uploads and
// stewarding files owes its members the plain answer, and because an app store
// listing cannot be published without a public page at a fixed address saying
// it. That second reason is why this page is deliberately BORING and specific:
// it names the actual fields, not "certain data may be processed".
//
// Every claim below was read off the code and is meant to stay that way. The
// ones that will rot first, with where they live:
//
//   scope "identify"        routes/discordAuth.js  (no email, no server list)
//   30-day session token    middleware/auth.js     (localStorage, not a cookie)
//   rotating daily hash     lib/traffic.js         (raw ip never stored, 6 months)
//   youtube-nocookie        utils/streamEmbed.js
//   self-hosted fonts/flags public/fonts, public/flags
//
// If one of those changes, this page is part of the change.
//
// FOUR THINGS ON THIS PAGE ARE NOT IN THIS FILE: who is responsible, their
// address and email, and the name of the Android app. Those are a league
// decision rather than a description of the software, and the person who has to
// answer for them does not edit code, so they are an admin form (Site content →
// Privacy) backed by /api/settings/privacy. While they are unset the page says
// so and points at Discord, which is the honest state, not a broken one.
// ---------------------------------------------------------------------------

const LAST_UPDATED = "26 August 2026";

function Section({ title, children }) {
  return (
    <section className="border-t border-border py-6 first:border-t-0 first:pt-0 sm:py-8">
      <h2 className="font-display text-xl font-extrabold uppercase tracking-tight text-dark sm:text-2xl">
        {title}
      </h2>
      <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-light">{children}</div>
    </section>
  );
}

// Lead-in bold, rest normal: lets someone scan for the entry that concerns them
// without turning the page into a wall of colour.
function Item({ term, children }) {
  return (
    <li>
      <span className="font-semibold text-dark">{term}</span> {children}
    </li>
  );
}

function List({ children }) {
  return <ul className="list-disc space-y-2 pl-5 marker:text-faint">{children}</ul>;
}

export default function Privacy() {
  useSpecificTitle("Privacy · NABS Racing League");
  const social = useSocial();
  const discord = social.data?.discord;
  // Admin-supplied (see the note at the top). A failed request lands here as
  // undefined, which reads exactly like "not filled in yet" — the page has to
  // stand up either way, so there is nothing to handle separately.
  const { data: info } = useApi(useCallback(() => api.privacyInfo(), []));
  const controllerName = info?.controllerName?.trim() || "";
  const controllerAddress = info?.controllerAddress?.trim() || "";
  const controllerEmail = info?.controllerEmail?.trim() || "";
  const appName = info?.appName?.trim() || "";
  const hasController = !!(controllerName || controllerEmail);
  // The domain the reader is actually on, rather than one typed in here that
  // would go stale the day the site moves.
  const host = typeof window === "undefined" ? "" : window.location.host;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow="Legal"
        title="Privacy"
        subtitle="What this site stores about you, why it stores it, and how to get rid of it. Short version: results and lap times, because that is what a racing league is, plus your Discord name and picture if you sign in. No advertising, no tracking services, nothing sold to anyone."
      />

      {/* Google Play will not accept a policy that only ever mentions a
          website, so once the app has a name it gets named. Before that, saying
          "and our app" would be a claim about something that doesn't exist. */}
      <Section title="What this covers">
        <p>
          The NABS Racing League website{host ? <> at {host}</> : null}
          {appName ? <>, and the {appName} app for Android, which shows the same site</> : null}.
        </p>
      </Section>

      <Section title="Who is responsible">
        {hasController ? (
          <p>
            {controllerName}
            {controllerAddress ? <>, {controllerAddress}</> : null}
            {controllerEmail ? (
              <>
                . Privacy requests:{" "}
                {controllerEmail.includes("@") ? (
                  <a className="text-dark underline" href={"mailto:" + controllerEmail}>
                    {controllerEmail}
                  </a>
                ) : (
                  controllerEmail
                )}
              </>
            ) : null}
            .
          </p>
        ) : (
          <p>
            The NABS Racing League runs this site. The named contact for privacy questions is being
            finalised and will be listed here.{" "}
            {discord ? (
              <>
                Until then, the fastest way to reach the people who can answer is{" "}
                <a
                  className="text-dark underline"
                  href={discord}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  our Discord
                </a>
                : message an admin there.
              </>
            ) : (
              <>Until then, message an admin in the league Discord.</>
            )}
          </p>
        )}
      </Section>

      <Section title="If you only look around">
        <p>
          You can read the whole public site without signing in and without agreeing to anything.
          There is no cookie banner because there are no tracking cookies to ask about.
        </p>
        <List>
          <Item term="Page counter.">
            We count page views ourselves, on our own server. To tell two readers apart within a
            single day, the server builds a one-way fingerprint out of your IP address, your browser
            identification, the date and a secret. The IP address itself is never written to the
            database, and because the date is baked into the fingerprint it changes every night, so
            the same person cannot be followed from one day to the next. Those daily markers are
            deleted after about six months. No Google Analytics, no third-party counter.
          </Item>
          <Item term="Server logs.">
            Like every web server, ours and the hosting company's see the requests they answer,
            including IP addresses, for running the service and finding faults. They are not used to
            build profiles.
          </Item>
          <Item term="Your own browser.">
            Settings that only concern you stay on your device in local storage: light or dark mode,
            the inputs in the race calculators, which tab you last had open. That never reaches us.
          </Item>
        </List>
      </Section>

      <Section title="If you sign in with Discord">
        <p>
          Signing in is optional and only needed for member things: sign-ups, your profile,
          downloads, reports. We ask Discord for the smallest permission it offers, called
          "identify". From it we store:
        </p>
        <List>
          <Item term="Your Discord ID,">the number that identifies your account.</Item>
          <Item term="your Discord user name and display name,">
            as they are at the time you sign in.
          </Item>
          <Item term="your profile picture,">as a link to Discord's own image server.</Item>
          <Item term="when you first and last signed in,">and how often.</Item>
        </List>
        <p>
          We do not receive your email address, your password, the servers you are in or any of your
          messages, and we cannot post as you. Staying signed in works through a token kept in your
          browser's local storage that expires after 30 days. It is not an advertising cookie and no
          other site can read it.
        </p>
        <p>
          Admins can see this list of accounts, so that a login can be matched to the right driver
          and so that someone banned from the league stays out.
        </p>
      </Section>

      <Section title="If you link your Steam account">
        <p>
          Optional, and only useful for drivers: linking Steam lets the result import recognise you
          in an Assetto Corsa result file even the first time you race. We store your Steam ID and
          the date you proved it. Nothing else from your Steam profile is read, and you can race
          without it.
        </p>
      </Section>

      <Section title="If you race with us">
        <p>
          A results site is a public record, and this is the part of it that is about you. For
          drivers who take part in a season we store and show publicly:
        </p>
        <List>
          <Item term="Sporting data:">
            entries, starting positions, finishing positions, penalties, lap times, sector and
            telemetry data recorded during our sessions, championship points, and the ratings
            calculated from all of it.
          </Item>
          <Item term="Identity on the grid:">
            your driver name, your team, your country, a profile picture (your Discord one, or one
            you upload), and any social links you add yourself.
          </Item>
          <Item term="Taking part:">
            your sign-ups for each round, and which seats you showed interest in on the driver
            market.
          </Item>
        </List>
        <p>
          This is the league's sporting history. It is visible to everyone, including people who are
          not signed in, and it is the reason the site exists.
        </p>
      </Section>

      <Section title="Reports, feedback and messages">
        <List>
          <Item term="Stewarding reports:">
            what you wrote, which race and lap it concerns, who it is about, the messages in the
            thread and any files you attach. Visible to the stewards and to the drivers involved.
          </Item>
          <Item term="Feedback and bug reports:">
            your message, the page you were on, and a technical description of your browser and
            device, because that is usually what makes a bug reproducible. If you were signed in,
            your name is attached so an admin can answer; if you were not, only whatever you typed
            into the optional contact field.
          </Item>
          <Item term="Notifications:">
            the entries behind the bell, and the moment you last opened it, so that unread ones can
            stay marked unread.
          </Item>
        </List>
      </Section>

      <Section title="Why we are allowed to keep it">
        <p>
          European data protection law asks for a reason behind every stored field, not just an
          intention. Ours are these three, and nothing on this site rests on anything else.
        </p>
        <List>
          <Item term="Because you asked to take part.">
            Your account, your sign-ups, your seat in a season, the results of the season being
            driven, the downloads and the stewarding threads. Without storing them the league cannot
            do the thing you signed up for.
          </Item>
          <Item term="Because the league has a legitimate interest.">
            Running and securing the site, the visitor counter, the backups, keeping banned accounts
            out, and above all the permanent archive of past seasons. A championship that could be
            edited afterwards would not be a record of anything.
          </Item>
          <Item term="Because you switched it on yourself.">
            Everything optional: the Steam link, a profile picture you upload, your social links,
            what the notification bell may tell you. You can switch each of them off again, and doing
            so is not a favour you have to ask for.
          </Item>
        </List>
      </Section>

      <Section title="Who else is involved">
        <p>
          We keep the number of outside parties deliberately small. Fonts and country flags are
          hosted on our own server instead of being pulled from Google or a CDN, so simply reading
          the site does not report you to anyone.
        </p>
        <List>
          <Item term="Discord">
            handles the login itself and hosts the profile pictures, so your browser contacts Discord
            when one is shown. The league also lives there.
          </Item>
          <Item term="Steam">only if you use the optional account link.</Item>
          <Item term="YouTube and Twitch">
            only on pages that embed a stream or a video. Those players are loaded from their
            providers, which means your browser contacts them and their own privacy terms apply. We
            use YouTube's no-cookie player wherever YouTube offers it.
          </Item>
          <Item term="Our hosting provider">
            operates the server the site and its database run on.
          </Item>
        </List>
        <p>Nothing here is sold, rented or handed to advertisers.</p>
      </Section>

      <Section title="Data that leaves Europe">
        <p>
          Discord, Steam, YouTube and Twitch are United States companies, and our hosting provider
          may run the server outside the European Union. So some of what happens here does leave
          Europe, and it is only fair to say exactly when:
        </p>
        <List>
          <Item term="When you sign in with Discord,">
            or when a page shows a Discord profile picture, your browser talks to Discord and Discord
            learns your IP address.
          </Item>
          <Item term="When you press play on an embedded stream or video,">
            the same is true for YouTube or Twitch.
          </Item>
          <Item term="When you use the optional Steam link,">the same is true for Steam.</Item>
          <Item term="The site's own database and files">
            sit with our hosting provider, wherever that company runs the server.
          </Item>
        </List>
        <p>
          Those transfers rest on the European Commission's standard contractual clauses, or on the
          EU-US Data Privacy Framework where the company is certified under it. Countries outside the
          EU do not all offer the same level of protection, and no contract fully changes that. If
          you would rather not be part of it, you can read the site without signing in and skip the
          embedded players.
        </p>
      </Section>

      <Section title="How long we keep it">
        <List>
          <Item term="Daily visitor markers:">about six months, then deleted.</Item>
          <Item term="Your account:">for as long as you have one.</Item>
          <Item term="Race results:">
            as long as the league keeps its archive, which in practice means indefinitely.
          </Item>
          <Item term="Backups:">
            copies of the database are made automatically and rotated, so something deleted today can
            survive in a backup for a while before it ages out.
          </Item>
        </List>
      </Section>

      <Section title="How it is kept safe">
        <p>
          A sim racing league is not a bank, and we will not pretend otherwise. What we do have:
        </p>
        <List>
          <Item term="No passwords to lose.">
            The site never sees one. Signing in happens at Discord, and the admin area's own PIN is
            stored only as a one-way hash, with a brake that locks out repeated wrong guesses.
          </Item>
          <Item term="Encrypted in transit.">
            The site is served over HTTPS, so what travels between your device and the server cannot
            be read on the way.
          </Item>
          <Item term="Locked-down browser rules.">
            The site refuses to be framed by another site, blocks file-type guessing, hands no full
            addresses to third parties, and switches off camera, microphone and location entirely.
          </Item>
          <Item term="Limited uploads.">
            Files members can send are size-capped and only accepted in known formats, stored under
            names the server picks rather than the ones they arrived with.
          </Item>
          <Item term="Backups.">
            The database is copied automatically before anything big is written, so a mistake or a
            broken server does not take the league's history with it.
          </Item>
          <Item term="Few hands.">
            The member data above is reachable by the league's admins, not by everyone in the
            Discord.
          </Item>
        </List>
        <p>
          No system is perfectly safe. If something does go wrong in a way that puts you at risk, we
          will say so rather than quietly hope.
        </p>
      </Section>

      <Section title="Your rights">
        <p>
          None of these needs a form, a reason or a formal tone. Ask an admin in Discord, or write to
          the contact above once it is listed.
        </p>
        <List>
          <Item term="Access:">to know what we hold about you, and to get a copy of it.</Item>
          <Item term="Correction:">to have anything wrong put right.</Item>
          <Item term="Deletion:">to have it removed, within the limit below.</Item>
          <Item term="Restriction:">
            to have us park data instead of using it, while something is being sorted out.
          </Item>
          <Item term="Portability:">
            to receive what you gave us in a machine-readable file, or have it sent on.
          </Item>
          <Item term="Objection:">
            to say no to anything we do on the grounds of legitimate interest.
          </Item>
          <Item term="Withdrawal:">
            to switch off anything optional you once switched on. What happened before stays lawful,
            it just stops there.
          </Item>
        </List>
        <p>
          Deletion you can do yourself, without asking anyone:{" "}
          <Link className="text-dark underline" to="/delete-account">
            delete your account
          </Link>{" "}
          says exactly what goes and what stays, and then does it. In short: your login, your
          pictures, your bio, your links and your messages to the admins go. The results of races you
          actually drove stay in the standings and the archive, because removing them would rewrite
          championships that the rest of the grid also drove. Stewarding threads stay too, with your
          name taken off them. If you want your racing name out of the archive as well, ask and we
          will work out what is possible.
        </p>
        <p>
          If you think we handled your data wrongly, you can complain to a data protection
          supervisory authority.
        </p>
      </Section>

      <Section title="Children">
        <p>
          The league is aimed at adults and older teenagers. We do not knowingly keep data on
          children under 13, and if you tell us we have, we will remove it.
        </p>
      </Section>

      <Section title="Changes">
        <p>
          When the site starts doing something new with data, this page changes with it and the date
          moves. Last updated: {LAST_UPDATED}.
        </p>
        <p className="text-sm">
          Wondering what the site actually is? Start at{" "}
          <Link className="text-dark underline" to="/join">
            How it works
          </Link>
          .
        </p>
      </Section>
    </div>
  );
}
