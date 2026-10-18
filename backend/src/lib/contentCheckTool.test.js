import { describe, it, expect } from "vitest";
import { contentCheckTool } from "./contentCheckTool.js";

// ---------------------------------------------------------------------------
// The downloadable Content Check. Nothing here runs Windows; what is pinned is
// what makes the file work once it lands on a driver's PC: the site address
// filled in, CRLF line endings for cmd.exe, plain ASCII (cmd reads a batch
// file in the console's code page), and a Host header that cannot write code
// into the script.
// ---------------------------------------------------------------------------

describe("contentCheckTool", () => {
  const body = contentCheckTool("https://nabs.example.com");

  it("asks the site it was downloaded from", () => {
    expect(body).toContain("$Site = 'https://nabs.example.com'");
    expect(body).not.toContain("__NABS_SITE__");
    expect(contentCheckTool("http://localhost:4000")).toContain("$Site = 'http://localhost:4000'");
  });

  it("is a batch file cmd.exe can read: CRLF throughout, ASCII only", () => {
    expect(body.split("\n").every((line, i, all) => i === all.length - 1 || line.endsWith("\r"))).toBe(true);
    expect(/^[\x00-\x7F]*$/.test(body)).toBe(true);
  });

  it("hides the batch lines from PowerShell inside one block comment", () => {
    const lines = body.split("\r\n");
    expect(lines[0].startsWith("<# :")).toBe(true);
    const close = lines.indexOf("#>");
    expect(close).toBeGreaterThan(0);
    expect(lines.slice(0, close).some((l) => l.startsWith("powershell.exe "))).toBe(true);
    // A second "#>" inside the batch part would end the comment early.
    expect(lines.slice(0, close).join("\n")).not.toContain("#>");
  });

  it("refuses an address that could break out of the quoted string", () => {
    expect(contentCheckTool("https://evil.example.com';Remove-Item C:\\")).toBeNull();
    expect(contentCheckTool("https://nabs.example.com/path")).toBeNull();
    expect(contentCheckTool("javascript:alert(1)")).toBeNull();
    expect(contentCheckTool("")).toBeNull();
  });
});
