import { describe, it, expect } from "vitest";
import { withConnectionLimit } from "./prisma.js";

describe("withConnectionLimit", () => {
  it("caps the pool of a SQLite file", () => {
    expect(withConnectionLimit("file:/data/dev.db", 4)).toBe("file:/data/dev.db?connection_limit=4");
    expect(withConnectionLimit("file:./dev.db?socket_timeout=10", 4)).toBe("file:./dev.db?socket_timeout=10&connection_limit=4");
  });

  it("keeps a limit the address already names", () => {
    expect(withConnectionLimit("file:/data/dev.db?connection_limit=8", 4)).toBe("file:/data/dev.db?connection_limit=8");
  });

  it("leaves anything that is not a SQLite file alone", () => {
    expect(withConnectionLimit(undefined)).toBe(undefined);
    expect(withConnectionLimit("")).toBe("");
    expect(withConnectionLimit("postgresql://localhost/nabs")).toBe("postgresql://localhost/nabs");
  });
});
