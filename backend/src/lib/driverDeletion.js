// ---------------------------------------------------------------------------
// Removing a driver row for good, and everything that has to go with it.
//
// Shared by the admin's driver delete (single and bulk, routes/admin.js) and by
// turning a newcomer away (lib/newcomers.js), so the two can never disagree
// about what a deleted row leaves behind.
// ---------------------------------------------------------------------------

// What names a driver row without a foreign key, and so is left pointing at
// nothing when the row is deleted. Driver ids are derived (`<id>_s<N>`), so a
// row created later under the same id would otherwise inherit all of it: the
// person link, recorded transfers (which decide the team its rounds are saved
// under), and the picks and reports that name it.
export function driverRefCleanup(prisma, driverId) {
  return [
    prisma.$executeRaw`DELETE FROM "PersonLink" WHERE "driverId" = ${driverId}`,
    prisma.$executeRaw`DELETE FROM "DriverTeamChange" WHERE "driverId" = ${driverId}`,
    prisma.$executeRaw`UPDATE "Race" SET "driverOfTheDayId" = NULL, "driverOfTheDayBy" = NULL WHERE "driverOfTheDayId" = ${driverId}`,
    prisma.$executeRaw`UPDATE "Season" SET "championDriverId" = NULL WHERE "championDriverId" = ${driverId}`,
    // The report keeps the name it was filed against (accusedName).
    prisma.$executeRaw`UPDATE "Report" SET "accusedDriverId" = NULL WHERE "accusedDriverId" = ${driverId}`,
    // A news comment keeps its author's Discord id; only the row it showed
    // the author as goes, so a later driver under the same id does not inherit
    // somebody else's comments.
    prisma.$executeRaw`UPDATE "NewsComment" SET "driverId" = NULL WHERE "driverId" = ${driverId}`,
  ];
}

// The statements that delete one row: raw references first (no FK cascade),
// then everything that references the row, then the row itself. Meant for ONE
// $transaction, so a delete the foreign keys refuse leaves the person link
// standing. A row with race results is refused by the foreign key; callers
// check for results first and say so in words.
export function deleteDriverOps(prisma, driverId) {
  return [
    ...driverRefCleanup(prisma, driverId),
    prisma.raceRsvp.deleteMany({ where: { driverId } }),
    prisma.seatInterest.deleteMany({ where: { driverId } }),
    // Offers they made: drop them (any interests cascade with the offer).
    prisma.seatOffer.deleteMany({ where: { driverId } }),
    // Offers they were chosen to FILL belong to another driver. Keep those,
    // just un-pick the deleted reserve so the seat reads open again.
    prisma.seatOffer.updateMany({ where: { filledById: driverId }, data: { filledById: null, status: "OPEN" } }),
    prisma.driver.delete({ where: { id: driverId } }),
  ];
}
