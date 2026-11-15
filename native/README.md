# PokeSwipe als native App (iOS & Android)

Die App ist eine Capacitor-Hülle um die Live-Web-App `https://pokeswipe-radar.de`.
Login, Sammlung, Scanner, Community, Marktplatz und Updates funktionieren deshalb wie im Browser, und Änderungen an der Website sind ohne neues App-Store-Release sofort in der App.

Die native Hülle ergänzt:

- **Kamera** für den Live-Scanner: Rückkamera, Taschenlampe, Erkennung direkt auf dem Gerät
- **Push über Firebase Cloud Messaging** (iOS und Android)
- **Zurück-Taste** unter Android, die erst offene Fenster schließt
- **App- und Universal Links**: `pokeswipe-radar.de/...` öffnet direkt die App
- **Externe Links** (eBay, Cardmarket) öffnen im System-Browser

## Voraussetzungen

- Node.js 22 oder neuer und `npm install` im Projektordner
- **iOS**: Mac mit Xcode 16+, Apple Developer Program (99 €/Jahr)
- **Android**: Android Studio (aktuell), Google-Play-Entwicklerkonto (einmalig 25 $)

## 1. Native Projekte anlegen (einmalig)

```bash
npm install
npm run cap:add      # legt ios/ und android/ an und trägt Berechtigungen und App-Links ein
```

`scripts/cap-native-setup.mjs` ergänzt automatisch:

| Plattform | Eintrag | Zweck |
|---|---|---|
| iOS `Info.plist` | `NSCameraUsageDescription` | Live-Scanner, Pull-Fotos |
| iOS `Info.plist` | `NSPhotoLibraryUsageDescription`, `NSPhotoLibraryAddUsageDescription` | Fotos posten bzw. Teilen-Bilder speichern |
| iOS `Info.plist` | `NSLocationWhenInUseUsageDescription` | Sammler-Radar |
| iOS `Info.plist` | `UIBackgroundModes: remote-notification` | Push |
| iOS `App.entitlements` | `aps-environment`, `applinks:pokeswipe-radar.de` | Push, Universal Links |
| Android `AndroidManifest.xml` | `CAMERA`, `POST_NOTIFICATIONS`, `ACCESS_*_LOCATION`, `READ_MEDIA_IMAGES` | wie oben |
| Android `AndroidManifest.xml` | Intent-Filter `https://pokeswipe-radar.de` (autoVerify) | App Links |

Nach Änderungen an Plugins oder `capacitor.config.ts`:

```bash
npm run cap:sync
```

## 2. Push einrichten (Firebase Cloud Messaging)

1. In der [Firebase-Konsole](https://console.firebase.google.com) eine iOS-App (`de.pokeswiperadar.app`) und eine Android-App (`de.pokeswiperadar.app`) anlegen.
2. **Android**: `google-services.json` nach `android/app/` kopieren.
3. **iOS**:
   - `GoogleService-Info.plist` in Xcode zu `App/App` hinzufügen.
   - In Firebase unter Projekt-Einstellungen → Cloud Messaging einen **APNs-Schlüssel (.p8)** hochladen.
   - In Xcode unter *Signing & Capabilities* „Push Notifications“ und „Associated Domains“ hinzufügen. Die Datei `App.entitlements` ist schon vorbereitet.
   - Firebase Messaging einbinden, damit die App ein FCM-Token statt eines APNs-Tokens meldet:
     - `ios/App/Podfile`: unter `target 'App'` die Zeile `pod 'FirebaseMessaging'` ergänzen, dann `npx cap sync ios`.
     - `ios/App/App/AppDelegate.swift`:

   ```swift
   import FirebaseCore
   import FirebaseMessaging

   // in application(_:didFinishLaunchingWithOptions:)
   FirebaseApp.configure()

   func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
     Messaging.messaging().apnsToken = deviceToken
     Messaging.messaging().token { token, _ in
       NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: token ?? "")
     }
   }
   func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
     NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
   }
   ```

4. In Firebase unter Projekt-Einstellungen → Dienstkonten einen **privaten Schlüssel (JSON)** erzeugen.
5. In Netlify unter **Project configuration → Environment variables** die Variable `FCM_SERVICE_ACCOUNT` mit dem Inhalt der JSON-Datei anlegen, entweder einzeilig oder Base64-kodiert.

Danach sendet der Server jede Mitteilung (Preisalarm, Tausch, Bestellung, Community) zusätzlich an die App.
Web-Push im Browser bleibt unverändert.

## 3. Universal Links und App Links

Damit Links wie `pokeswipe-radar.de/u/glurakking` oder `/p/123` direkt die App öffnen, in Netlify setzen:

| Variable | Wert |
|---|---|
| `APPLE_TEAM_ID` | 10-stellige Team-ID aus dem Apple-Developer-Konto |
| `ANDROID_CERT_SHA256` | SHA-256-Fingerabdruck des Signatur-Zertifikats (Play Console → App-Integrität), mehrere mit Komma trennen |

Der Server liefert dann `/.well-known/apple-app-site-association` und `/.well-known/assetlinks.json` aus.

## 4. Bauen und veröffentlichen

```bash
npm run cap:ios       # Xcode: Team wählen → Product → Archive → App Store Connect
npm run cap:android   # Android Studio: Build → Generate Signed App Bundle (.aab) → Google Play Console
```

Store-Material:

- Icons liegen in `public/icons/` (512 px, maskable).
- Screenshots am besten direkt aus der App aufnehmen.

Tipps für die Prüfung:

- Apple prüft Web-Hüllen streng (Richtlinie 4.2). Kamera-Scanner, Push und Offline-Modus sind native Funktionen, die in der Beschreibung genannt werden sollten.
- Für den Marktplatz mit Treuhand: Die Bezahlung physischer Waren über Stripe ist bei Apple und Google erlaubt (keine In-App-Käufe nötig).
- Digitale Abos (Premium/Pro) müssen in iOS-Apps laut Apple-Richtlinie 3.1.1 über In-App-Käufe laufen. Deshalb öffnet die iOS-App keine Stripe-Abo-Kasse (`client/pwa.js`). Bestehende Abos gelten in der App automatisch. Android und Web sind nicht betroffen. Wer Abos auch in der iOS-App verkaufen will, muss StoreKit anbinden.

## Lokal gegen einen Deploy-Preview testen

```bash
CAP_SERVER_URL=https://deploy-preview-123--pokeswipe-radar.netlify.app npm run cap:sync
```
