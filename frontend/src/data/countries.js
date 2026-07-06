// ISO 3166-1 alpha-2 codes for the country picker. Names are derived at runtime
// with Intl.DisplayNames (so we don't hand-maintain ~200 names), then sorted
// alphabetically. Flag images are self-hosted in public/flags (see Flag.jsx).

const CODES =
  "ad ae af ag al am ao ar at au az ba bb bd be bf bg bh bi bj bn bo br bs bt bw by bz ca cd cg ch ci cl cm cn co cr cu cv cy cz de dj dk dm do dz ec ee eg er es et fi fj fm fr ga gb gd ge gh gm gn gq gr gt gw gy hn hr ht hu id ie il in iq ir is it jm jo jp ke kg kh ki km kn kp kr kw kz la lb lc li lk lr ls lt lu lv ly ma mc md me mg mh mk ml mm mn mr mt mu mv mw mx my mz na ne ng ni nl no np nr nz om pa pe pg ph pk pl pt py qa ro rs ru rw sa sb sc sd se sg si sk sl sm sn so sr ss st sv sy sz td tg th tj tl tm tn to tr tt tv tw tz ua ug us uy uz va vc ve vn vu ws ye za zm zw"
    .split(" ");

let regionNames = null;
try {
  regionNames = new Intl.DisplayNames(["en"], { type: "region" });
} catch {
  regionNames = null;
}

function nameFor(code) {
  try {
    return regionNames?.of(code.toUpperCase()) || code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

// [{ code, name }] sorted by display name.
export const COUNTRIES = CODES.map((code) => ({ code, name: nameFor(code) })).sort((a, b) =>
  a.name.localeCompare(b.name)
);
