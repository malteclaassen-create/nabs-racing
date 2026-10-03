// ---------------------------------------------------------------------------
// One driver, two Discord accounts.
//
// A driver row carries exactly one Discord id, and everything a member does on
// the site (attendance, the driver market, their profile, tokens, the bell)
// follows that id. Someone who logs in with two Discord accounts is therefore
// two people to the site: the second account has no driver, or a driver row of
// its own, and an attendance sign-up from the "wrong" account puts them into
// the Reserve pool a second time. Merging the rows (Transfers tab) does not
// help, because the next sign-up from the other account makes the row again.
//
// So the ACCOUNTS are joined instead. The admin marks one account as the
// second account of the other (MemberAccount.mainDiscordId):
//
//   * a login through the second account acts as the main account everywhere
//     a member acts as themselves (middleware/auth.js, routes/discordAuth.js):
//     same driver, same sign-ups, same tokens, same notifications;
//   * steward and race control come along (same person), but the admin area
//     does NOT: it stays on the account it was given to, so a link set on the
//     Members tab can never hand anybody the admin area;
//   * a ban on either account stops both.
//
// Linking also tidies the driver rows: the second account's row moves to the
// main account when the main has none, otherwise the two rows are joined as
// one person (persons.js) so attendance and career follow the same human.
// A row in the same season as the main's is then a duplicate for the Merge on
// the Transfers tab.
//
// Undoing it takes the second account back to standing on its own, without a
// driver: which row was "its" one cannot be known any more, so the admin links
// it again on the Members tab if it should have one.
//
// The second account's own NABS Tokens stay where they are (on that account)
// and are back the moment the link is undone; nothing is moved between wallets.
// ---------------------------------------------------------------------------
import { dbGetMember, dbClearRaceRequest, getAltMap, mainOf, invalidateAltCache } from "./members.js";
import { dbLinkDrivers } from "./persons.js";

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// What linking `altId` under `mainId` would do, from the facts alone. Pure, so
// the rules are tested without a database (accountLinks.test.js).
//   altMap   Map<second account, main account> as it stands
//   altRow   the driver row carrying the second account's id, or null
//   mainRow  the driver row carrying the main account's id, or null
export function planAccountLink({ altId, mainId, altMap, altRow = null, mainRow = null }) {
  if (!altId || !mainId) return { error: "Pick both accounts" };
  const alt = String(altId);
  // Linking under a second account means linking under ITS main: links stay
  // one level deep.
  const main = mainOf(altMap || new Map(), String(mainId));
  if (main === alt) return { error: "That is the same account twice" };
  let rows = "none";
  if (altRow && !mainRow) rows = "move"; // the main account takes the row over
  else if (altRow && mainRow && altRow.id !== mainRow.id) rows = "join"; // one person, two rows
  return { main, alt, rows };
}

// Mark `altId` as a second account of `mainId`. Returns what was done.
export async function linkAccounts(prisma, { altId, mainId }) {
  const [altAcc, mainAcc] = await Promise.all([dbGetMember(prisma, String(altId || "")), dbGetMember(prisma, String(mainId || ""))]);
  if (!altAcc) throw fail(404, "The second account has never logged in on the site");
  if (!mainAcc) throw fail(404, "The main account has never logged in on the site");

  const altMap = await getAltMap(prisma);
  const mainRoot = mainOf(altMap, String(mainId));
  const [altRow, mainRow] = await Promise.all([
    prisma.driver.findUnique({ where: { discordUserId: String(altId) } }),
    prisma.driver.findUnique({ where: { discordUserId: mainRoot } }),
  ]);
  const plan = planAccountLink({ altId, mainId, altMap, altRow, mainRow });
  if (plan.error) throw fail(400, plan.error);
  const { main, alt } = plan;

  await prisma.$transaction(async (tx) => {
    // The second account's own second accounts now belong to the main one.
    await tx.$executeRaw`UPDATE "MemberAccount" SET "mainDiscordId" = ${main} WHERE "mainDiscordId" = ${alt}`;
    await tx.$executeRaw`UPDATE "MemberAccount" SET "mainDiscordId" = ${main} WHERE "discordId" = ${alt}`;

    if (plan.rows === "move") {
      await tx.driver.update({ where: { id: altRow.id }, data: { discordUserId: main } });
    } else if (plan.rows === "join") {
      // discordUserId is unique, and the main account already has its row:
      // the second account's row lets go of the id and joins the person.
      await tx.driver.update({ where: { id: altRow.id }, data: { discordUserId: null } });
      await dbLinkDrivers(tx, [mainRow.id, altRow.id]);
    }

    // A Steam account the second account proved, when the main has none: the
    // person proved it, and the import matches results by it.
    const altAccount = await dbGetMember(tx, alt);
    const mainAccount = await dbGetMember(tx, main);
    if (altAccount?.steamId && !mainAccount?.steamId) {
      const steamId = altAccount.steamId;
      const verifiedAt = altAccount.steamVerifiedAt ?? null;
      await tx.$executeRaw`UPDATE "MemberAccount" SET "steamId" = NULL, "steamVerifiedAt" = NULL WHERE "discordId" = ${alt}`;
      await tx.$executeRaw`UPDATE "MemberAccount" SET "steamId" = ${steamId}, "steamVerifiedAt" = ${verifiedAt} WHERE "discordId" = ${main}`;
    }
  });
  // A "wants to race" hand-raise from the second account is answered now.
  await dbClearRaceRequest(prisma, alt).catch(() => {});
  invalidateAltCache();

  return {
    alt,
    main,
    rows: plan.rows,
    altRow: altRow ? { id: altRow.id, name: altRow.name } : null,
    mainRow: mainRow ? { id: mainRow.id, name: mainRow.name } : null,
  };
}

// The second account stands on its own again (no driver; see the top).
export async function unlinkAccount(prisma, altId) {
  const acc = await dbGetMember(prisma, String(altId || ""));
  if (!acc) throw fail(404, "Account not found");
  if (!acc.mainDiscordId) throw fail(400, "This account is not a second account");
  await prisma.$executeRaw`UPDATE "MemberAccount" SET "mainDiscordId" = NULL WHERE "discordId" = ${String(altId)}`;
  invalidateAltCache();
  return { alt: String(altId), main: String(acc.mainDiscordId) };
}
