import test from "node:test";
import assert from "node:assert/strict";
import { answerWords, fillHelp, helpSlugs, matchesHelp, parseHelp, slugify } from "./helpText.mjs";

test("slugs read like the question and survive accents and quotes", () => {
  assert.equal(slugify('I get kicked with "Checksum failed"'), "i-get-kicked-with-checksum-failed");
  assert.equal(slugify("Réplay?"), "replay");
  assert.equal(slugify("???"), "question");
});

test("two questions with the same wording get their own address", () => {
  const slugs = helpSlugs([
    { title: "A", items: [{ q: "Where?", a: "x" }] },
    { title: "B", items: [{ q: "Where?", a: "y" }, { q: "When", a: "z" }] },
  ]);
  assert.deepEqual(slugs, [["where"], ["where-2", "when"]]);
});

test("search wants every word, in any order, question or answer", () => {
  const it = { q: 'I get kicked with "Checksum failed"', a: "Use the Content Check." };
  assert.ok(matchesHelp(it, "checksum kicked"));
  assert.ok(matchesHelp(it, "content"));
  assert.ok(!matchesHelp(it, "checksum replay"));
});

test("answers split into paragraphs with bold and links", () => {
  const p = parseHelp("Open the [Content Check](/content-check), it is **free**.\n\nSecond one.");
  assert.equal(p.length, 2);
  assert.deepEqual(p[0], [
    { text: "Open the " },
    { link: "Content Check", href: "/content-check", kind: "internal" },
    { text: ", it is " },
    { bold: "free" },
    { text: "." },
  ]);
  assert.deepEqual(p[1], [{ text: "Second one." }]);
});

test("only site paths and http(s) become links", () => {
  assert.deepEqual(parseHelp("[x](javascript:alert(1))")[0][0], { text: "x" });
  assert.deepEqual(parseHelp("[x](//evil.example)")[0], [{ text: "x" }]);
  assert.equal(parseHelp("[Discord](https://discord.gg/abc)")[0][0].kind, "external");
});

test("{answers} names only the sign-up answers that are switched on", () => {
  assert.equal(answerWords(["ACCEPTED", "DECLINED"]), "**Accepted** or **Declined**");
  assert.equal(answerWords(["DECLINED", "TENTATIVE", "ACCEPTED"]), "**Accepted**, **Tentative** or **Declined**");
  assert.equal(answerWords(undefined), "**Accepted**, **Tentative** or **Declined**");
  assert.equal(answerWords(["ACCEPTED", "DECLINED"], { bold: false }), "Accepted or Declined");
  assert.equal(fillHelp("Pick {answers}. {typo}", { answers: "A or B" }), "Pick A or B. {typo}");
  // A list typed out before the placeholder existed follows the setting too.
  assert.equal(fillHelp("Mark **Accepted**, **Tentative** or **Declined** now", { answers: "X" }), "Mark X now");
  assert.equal(fillHelp("Accepted, Tentative, or Declined", { answers: "X" }), "X");
});
