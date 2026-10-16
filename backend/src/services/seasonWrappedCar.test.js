import { describe, expect, it } from "vitest";
import { seasonCarOf } from "./seasonWrappedService.js";

// The story opens on the season's real car: the picture an admin uploaded.
describe("the season's car picture for Wrapped", () => {
  it("is the uploaded picture of that season", async () => {
    const asked = [];
    const prisma = {
      $queryRawUnsafe: async (sql, id) => {
        asked.push(id);
        return [{ carImageUrl: "/api/uploads/seasons/season7-car.jpg?v=1" }];
      },
    };
    expect(await seasonCarOf(prisma, "season7")).toBe("/api/uploads/seasons/season7-car.jpg?v=1");
    expect(asked).toEqual(["season7"]);
  });

  it("is null without an upload, or where the column cannot be read", async () => {
    expect(await seasonCarOf({ $queryRawUnsafe: async () => [{ carImageUrl: null }] }, "s6")).toBeNull();
    expect(await seasonCarOf({ $queryRawUnsafe: async () => [] }, "s6")).toBeNull();
    expect(await seasonCarOf({ $queryRawUnsafe: () => Promise.reject(new Error("no such column")) }, "s6")).toBeNull();
    expect(await seasonCarOf({}, "s6")).toBeNull();
  });
});
