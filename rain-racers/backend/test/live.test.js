import { describe, it, expect } from "vitest";
import { liveSocketUrl, cleanSettings } from "../src/lib/settings.js";

describe("live server address", () => {
  it("turns what an admin pastes into the live socket", () => {
    expect(liveSocketUrl("https://rain.emperorservers.com/live-timing")).toBe("wss://rain.emperorservers.com/api/race-control");
    expect(liveSocketUrl("rain.emperorservers.com")).toBe("wss://rain.emperorservers.com/api/race-control");
    expect(liveSocketUrl(" wss://sahara.emperorservers.com/api/race-control ")).toBe("wss://sahara.emperorservers.com/api/race-control");
    expect(liveSocketUrl("http://localhost:4100/live-timing")).toBe("ws://localhost:4100/api/race-control");
  });
  it("has nothing for what is not an address", () => {
    expect(liveSocketUrl("")).toBe("");
    expect(liveSocketUrl("hello")).toBe("");
  });
  it("saves the socket in the settings", () => {
    expect(cleanSettings({ liveWsUrl: "https://rain.emperorservers.com/live-timing" }).liveWsUrl).toBe("wss://rain.emperorservers.com/api/race-control");
  });
});

describe("join link", async () => {
  const { joinLinkIn } = await import("../src/live/links.js");
  it("is read off the server manager's live timing page", () => {
    const html = `<a id="cm-join-link" href="https://acstuff.ru/s/q:race/online/join?httpPort=9619&amp;ip=145.239.9.197" target="_blank">Join</a>`;
    expect(joinLinkIn(html)).toBe("https://acstuff.ru/s/q:race/online/join?httpPort=9619&ip=145.239.9.197");
    expect(joinLinkIn("<p>server offline</p>")).toBe(null);
  });
});
