// Deleting your own account.
//
// Required by Google Play for any app that lets people create an account, and
// right regardless of that. The hard part is not the deleting, it is deciding
// what a "your account" even is on a results site, because two things are
// tangled together:
//
//   THE PERSON   the login, the picture, the bio, the links, the country, the
//                number: things this individual typed about themselves. All of
//                it goes.
//   THE RACING   entries, positions, lap times, points, the ratings computed
//                from them, and the name they were entered under. None of it
//                goes. Deleting a driver out of season 6 would rewrite a
//                championship that eleven other people also drove, and their
//                results are their data too.
//
// The public page at /delete-account states that split in the same words, so
// nobody arrives at the button expecting the other outcome.
//
// Two places do NOT get a clean delete, on purpose:
//
//   Stewarding threads  are a dispute record between two drivers and the
//                       officials. One party erasing their half would leave the
//                       other holding an accusation with no context, so the
//                       thread stays and the name on it is removed instead.
//   A ban               survives, as a row carrying nothing but the Discord id
//                       and the ban. Otherwise "delete account, sign in again"
//                       would be a one-click way back into a league that showed
//                       you the door. In practice a banned member cannot reach
//                       this code at all (optionalUser refuses them), so this is
//                       a guard against the narrow window where a ban lands
//                       while a session is already open.
//
// Everything is one Prisma transaction so a half-deleted account cannot exist.
// The uploaded image FILES are removed after it commits: a failed unlink must
// not roll back a deletion the member has already been told about, and a
// leftover file nothing points at is harmless.
import { rmSync } from "node:fs";
import { join } from "node:path";
import { getLinkedDriverIds } from "../lib/persons.js";
import { safeUploadPath } from "../lib/safeUpload.js";
import { UPLOADS_DIR } from "../lib/dataDirs.js";

// What replaces a name that has been removed from a thread other people can
// still read. Deliberately not "Deleted user", which reads like an error.
const FORMER = "Former member";

const IMG_EXTS = [".png", ".jpg", ".jpeg", ".webp", ".gif"];

// Columns the generated Prisma client is not guaranteed to know about: several
// Driver columns are created in raw SQL at boot (see lib/ensureSchema.js), so a
// running server can hold a client that predates them. Cleared one by one and
// tolerantly, because a column that does not exist yet also holds no data.
const RAW_DRIVER_COLUMNS = ["profileTiles", "cardPhotoPos", "cardPhotoUrl", "cardStyle", "cardAnim"];

// Every Driver row belonging to this login: the one carrying the Discord id
// (that column is unique, so there is at most one) plus the same person's rows
// in other seasons, which hang together via PersonLink.
export async function driverRowsForMember(prisma, discordId) {
  const linked = await prisma.driver.findUnique({
    where: { discordUserId: discordId },
    select: { id: true },
  });
  if (!linked) return [];
  const ids = await getLinkedDriverIds(prisma, linked.id).catch(() => [linked.id]);
  return ids.length ? ids : [linked.id];
}

// What a deletion would touch, for the confirmation screen. Counting rather
// than describing: "3 seasons, 2 feedback threads" is checkable by the person
// reading it, "your data" is not.
export async function previewAccountDeletion(prisma, discordId) {
  const driverIds = await driverRowsForMember(prisma, discordId);
  const [seasons, feedback, reportsFiled, reportMessages, notifications, upcomingRsvps] =
    await Promise.all([
      driverIds.length
        ? prisma.driver.count({ where: { id: { in: driverIds } } })
        : Promise.resolve(0),
      prisma.feedback.count({ where: { discordId } }),
      prisma.report.count({ where: { reporterDiscordId: discordId } }),
      prisma.reportMessage.count({ where: { authorDiscordId: discordId } }),
      prisma.notification.count({ where: { recipientId: discordId } }),
      driverIds.length
        ? prisma.raceRsvp.count({
            where: { driverId: { in: driverIds }, race: { isCompleted: false } },
          })
        : Promise.resolve(0),
    ]);
  return { seasons, feedback, reportsFiled, reportMessages, notifications, upcomingRsvps };
}

// Delete the account. Returns the same shape as the preview, describing what
// actually happened, so the page can show it rather than a bare "done".
export async function deleteMemberAccount(prisma, discordId) {
  if (!discordId) throw Object.assign(new Error("No account"), { status: 400 });

  const driverIds = await driverRowsForMember(prisma, discordId);
  // Read the picture paths BEFORE the columns are cleared; the files are
  // removed once the transaction has committed.
  const photos = driverIds.length
    ? await prisma.driver
        .findMany({ where: { id: { in: driverIds } }, select: { id: true, photoUrl: true } })
        .catch(() => [])
    : [];

  const account = await prisma.memberAccount.findUnique({ where: { discordId } });
  const keepBan = !!account?.banned;

  const done = await prisma.$transaction(async (tx) => {
    let seasons = 0;
    if (driverIds.length) {
      // The person's own entries. Not the name and not the team: those are how
      // the results already published read.
      const res = await tx.driver.updateMany({
        where: { id: { in: driverIds } },
        data: {
          discordUserId: null,
          steamId: null,
          photoUrl: null,
          discordAvatar: null,
          socials: null,
          bio: null,
          country: null,
          number: null,
        },
      });
      seasons = res.count;
      for (const col of RAW_DRIVER_COLUMNS) {
        for (const id of driverIds) {
          await tx
            .$executeRawUnsafe(`UPDATE "Driver" SET "${col}" = NULL WHERE "id" = ?`, id)
            .catch(() => {});
        }
      }
    }

    // Messages to the admins are a private exchange between two parties, one of
    // whom is leaving. They go, replies included.
    const threads = await tx.feedback.findMany({ where: { discordId }, select: { id: true } });
    if (threads.length) {
      await tx.feedbackReply.deleteMany({ where: { feedbackId: { in: threads.map((t) => t.id) } } });
    }
    const feedback = (await tx.feedback.deleteMany({ where: { discordId } })).count;

    // Stewarding: the thread survives, the name on it does not.
    const reportsFiled = (
      await tx.report.updateMany({
        where: { reporterDiscordId: discordId },
        data: { reporterDiscordId: null, reporterName: FORMER },
      })
    ).count;
    const reportMessages = (
      await tx.reportMessage.updateMany({
        where: { authorDiscordId: discordId },
        data: { authorDiscordId: null, authorName: FORMER },
      })
    ).count;
    await tx.reportAttachment.updateMany({
      where: { uploaderDiscordId: discordId },
      data: { uploaderDiscordId: null },
    });
    // "Who has read this thread" is only useful while there is somebody to
    // show it to.
    await tx.reportViewer.deleteMany({ where: { discordId } });

    const notifications = (await tx.notification.deleteMany({ where: { recipientId: discordId } }))
      .count;

    if (keepBan) {
      await tx.memberAccount.update({
        where: { discordId },
        data: {
          username: FORMER,
          displayName: null,
          avatarUrl: null,
          steamId: null,
          steamVerifiedAt: null,
        },
      });
    } else {
      await tx.memberAccount.delete({ where: { discordId } }).catch(() => {});
    }

    return { seasons, feedback, reportsFiled, reportMessages, notifications, banKept: keepBan };
  });

  // Uploaded pictures. Named after the driver id, in two folders (profile and
  // card), and the extension is whatever they uploaded, so try each.
  for (const { id } of photos) {
    for (const dir of [join(UPLOADS_DIR, "avatars"), join(UPLOADS_DIR, "cards")]) {
      for (const ext of IMG_EXTS) {
        const file = safeUploadPath(dir, `${id}${ext}`);
        if (file) {
          try {
            rmSync(file, { force: true });
          } catch {
            /* a picture we could not remove is not worth failing a deletion for */
          }
        }
      }
    }
  }

  return done;
}
