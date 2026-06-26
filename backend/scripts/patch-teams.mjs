// One-off: bring the live DB's team names + colours in line with seed.js
// (fix "Torro Rosso" -> "Toro Rosso" and give every team a distinct colour).
// Non-destructive: only updates Team.name / Team.color, touches nothing else.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TEAMS = {
  porsche: { name: "Porsche Martini", color: "#1AA39B" },
  mclaren: { name: "McLaren", color: "#F58220" },
  ferrari: { name: "Ferrari", color: "#E10600" },
  williams: { name: "Williams", color: "#0067C0" },
  honda: { name: "Honda", color: "#A33EA1" },
  renault: { name: "Renault", color: "#BFA900" },
  super_aguri: { name: "Super Aguri", color: "#D85E88" },
  spyker: { name: "Spyker", color: "#C2410C" },
  torro_rosso: { name: "Toro Rosso", color: "#3F6FB0" },
  redbull: { name: "Red Bull", color: "#5A4FC4" },
  toyota: { name: "Toyota", color: "#FF7A66" },
  bmw: { name: "BMW Sauber", color: "#6E7B8B" },
  jaguar: { name: "Jaguar", color: "#14935A" },
  fiat: { name: "Fiat", color: "#B3446C" },
  lamborghini: { name: "Lamborghini", color: "#8DB600" },
  ncb_mugen: { name: "NCB Mugen", color: "#2E9BD6" },
  lotus: { name: "Lotus", color: "#E6A700" },
};

let changed = 0;
for (const [id, data] of Object.entries(TEAMS)) {
  // updateMany so a missing id (e.g. a future season's suffixed team) is a no-op
  // rather than throwing.
  const r = await prisma.team.updateMany({ where: { id }, data });
  changed += r.count;
  if (r.count) console.log(`  ${id.padEnd(13)} -> ${data.name} ${data.color}`);
}
console.log(`Updated ${changed} team(s).`);
await prisma.$disconnect();
