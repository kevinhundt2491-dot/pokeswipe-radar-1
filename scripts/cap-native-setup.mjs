// Phase 4: trägt nach `npx cap add ios|android` die nötigen Berechtigungen in die nativen Projekte ein
// (Kamera für den Live-Scanner, Fotos für Pull-Wall/KI-Scan, Standort für das Sammler-Radar, Push, App-Links).
// Mehrfach ausführbar – vorhandene Einträge bleiben unverändert.
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const log = (m) => console.log(`[cap-setup] ${m}`);

// ---------------- iOS: Info.plist ----------------
const plistPath = join(root, "ios/App/App/Info.plist");
if (existsSync(plistPath)) {
  let plist = readFileSync(plistPath, "utf8");
  const entries = {
    NSCameraUsageDescription: "PokeSwipe nutzt die Kamera, um Pokémon-Karten live zu erkennen und Fotos für die Pull-Wall aufzunehmen.",
    NSPhotoLibraryUsageDescription: "PokeSwipe greift auf deine Fotos zu, damit du Pulls posten und Karten per Foto scannen kannst.",
    NSPhotoLibraryAddUsageDescription: "PokeSwipe speichert Teilen-Bilder deiner Sammlung in deinen Fotos.",
    NSLocationWhenInUseUsageDescription: "PokeSwipe zeigt dir auf Wunsch Sammler und Tauschpartner in deiner Nähe (Sammler-Radar).",
  };
  for (const [key, text] of Object.entries(entries)) {
    if (!plist.includes(`<key>${key}</key>`)) {
      plist = plist.replace(/<\/dict>\s*<\/plist>\s*$/, `\t<key>${key}</key>\n\t<string>${text}</string>\n</dict>\n</plist>\n`);
      log(`iOS: ${key} ergänzt`);
    }
  }
  if (!plist.includes("<key>UIBackgroundModes</key>")) {
    plist = plist.replace(/<\/dict>\s*<\/plist>\s*$/, `\t<key>UIBackgroundModes</key>\n\t<array>\n\t\t<string>remote-notification</string>\n\t</array>\n</dict>\n</plist>\n`);
    log("iOS: Hintergrund-Push (remote-notification) ergänzt");
  }
  writeFileSync(plistPath, plist);
  // Push-Berechtigung + Associated Domains (Universal Links) über Entitlements
  const entPath = join(root, "ios/App/App/App.entitlements");
  if (!existsSync(entPath)) {
    writeFileSync(entPath, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>aps-environment</key>
\t<string>production</string>
\t<key>com.apple.developer.associated-domains</key>
\t<array>
\t\t<string>applinks:pokeswipe-radar.de</string>
\t</array>
</dict>
</plist>
`);
    log("iOS: App.entitlements angelegt (Push + Universal Links) – in Xcode unter Signing & Capabilities zuordnen");
  }
} else log("iOS-Projekt fehlt – übersprungen (npx cap add ios)");

// ---------------- Android: AndroidManifest.xml ----------------
const manifestPath = join(root, "android/app/src/main/AndroidManifest.xml");
if (existsSync(manifestPath)) {
  let xml = readFileSync(manifestPath, "utf8");
  const perms = [
    "android.permission.INTERNET", "android.permission.CAMERA", "android.permission.POST_NOTIFICATIONS",
    "android.permission.ACCESS_COARSE_LOCATION", "android.permission.ACCESS_FINE_LOCATION", "android.permission.READ_MEDIA_IMAGES",
  ];
  for (const p of perms) {
    if (!xml.includes(`android:name="${p}"`)) {
      xml = xml.replace(/<application/, `<uses-permission android:name="${p}" />\n    <application`);
      log(`Android: ${p} ergänzt`);
    }
  }
  if (!xml.includes('android:name="android.hardware.camera"')) {
    xml = xml.replace(/<application/, `<uses-feature android:name="android.hardware.camera" android:required="false" />\n    <application`);
  }
  // App-Links: https://pokeswipe-radar.de/... direkt in der App öffnen
  if (!xml.includes('android:host="pokeswipe-radar.de"')) {
    xml = xml.replace(/(<activity[^>]*MainActivity[^>]*>)/, `$1
            <intent-filter android:autoVerify="true">
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="https" android:host="pokeswipe-radar.de" />
            </intent-filter>`);
    log("Android: App-Links für pokeswipe-radar.de ergänzt");
  }
  writeFileSync(manifestPath, xml);
  // Benachrichtigungs-Symbol (weiß, für die Statusleiste)
  const icon = join(root, "public/icons/badge-96.png");
  const dir = join(root, "android/app/src/main/res/drawable");
  if (existsSync(icon)) { mkdirSync(dir, { recursive: true }); copyFileSync(icon, join(dir, "ic_stat_pokeswipe.png")); }
  if (!existsSync(join(root, "android/app/google-services.json"))) log("Android: android/app/google-services.json aus der Firebase-Konsole fehlt noch (für Push)");
} else log("Android-Projekt fehlt – übersprungen (npx cap add android)");
