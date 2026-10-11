// NABS Racing · Installer
// Paste this once into a new Scriptable script and tap ▶︎.
// It downloads the latest NABS Setup from nabsracing.com and starts it.
// For future updates just run this script again.

const URL = "https://nabsracing.com/widgets/nabs-setup.js"

let fm = FileManager.local()
try {
  const ic = FileManager.iCloud()
  if (module.filename.indexOf(ic.documentsDirectory()) === 0) fm = ic
} catch (e) {}

const req = new Request(URL + "?t=" + Date.now())
req.timeoutInterval = 20
let code = ""
try { code = await req.loadString() } catch (e) {}

if (code.indexOf("NABS Racing · Widget Setup") < 0) {
  const a = new Alert()
  a.title = "Download failed"
  a.message = "Could not load the NABS Setup from nabsracing.com. Check your connection and try again."
  a.addAction("OK")
  await a.presentAlert()
} else {
  fm.writeString(fm.joinPath(fm.documentsDirectory(), "NABS Setup.js"), code)
  Safari.open("scriptable:///run/" + encodeURIComponent("NABS Setup"))
}
Script.complete()
