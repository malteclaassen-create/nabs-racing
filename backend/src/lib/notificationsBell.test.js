import { describe, expect, it } from "vitest";
import { dbListNotificationsFor, dbUnreadCount } from "./notifications.js";

// Admin to-dos (type ADMIN) are the admin area's To do card, not bell
// entries. Both bell queries have to leave them out — the list AND the
// unread number, or the badge counts rows the dropdown never shows.
function capture(rows) {
  const calls = [];
  const prisma = {
    $queryRaw: async (strings, ...values) => {
      calls.push({ sql: strings.join("?"), values });
      return rows;
    },
  };
  return { prisma, calls };
}

describe("the bell leaves admin to-dos out", () => {
  it("in the list", async () => {
    const { prisma, calls } = capture([]);
    await dbListNotificationsFor(prisma, "123");
    expect(calls[0].sql).toMatch(/"type" <> \?/);
    expect(calls[0].values).toContain("ADMIN");
  });

  it("in the unread count", async () => {
    const { prisma, calls } = capture([{ n: 0 }]);
    await dbUnreadCount(prisma, "123");
    expect(calls[0].sql).toMatch(/"type" <> \?/);
    expect(calls[0].values).toContain("ADMIN");
  });
});
