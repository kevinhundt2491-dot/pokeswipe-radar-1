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

- Apple prüft Web-Hüllen streng (Richtlinie 4.2). Die App nutzt deshalb echte native Funktionen (`client/native.js`) –
  diese in der App-Beschreibung und in den Prüf-Notizen nennen:
  - **Haptik** (`@capacitor/haptics`) beim Erkennen einer Karte, beim Swipen, bei Deal-/Restock-Treffern und in der Navigation
  - **Native Kamera** (`@capacitor/camera`) für den Foto-Scan, **Live-Scanner** mit Erkennung direkt auf dem Gerät
  - **Push** (`@capacitor/push-notifications`) für Preis- und Restock-Alarme
  - **Natives Teilen-Sheet** (`@capacitor/share`) für Pull-Wall, Profile, Shops und Einladungen
  - **Status-Leiste & Safe Area** (`@capacitor/status-bar`, `env(safe-area-inset-*)`) für Dynamic Island, Notch und Home-Indikator
  - **Offline-Modus**, Zurück-Taste (Android), Universal Links
- Für den Marktplatz mit Treuhand: Die Bezahlung physischer Waren über Stripe ist bei Apple und Google erlaubt (keine In-App-Käufe nötig).

## 5. Abos in der iOS-App (Apple In-App-Kauf / EU-DMA)

Digitale Abos (Premium/Pro Trader) müssen in iOS-Apps laut Apple-Richtlinie 3.1.1 über In-App-Käufe laufen. Die
Zahlungs-Weiche in `client/payments.js` wählt automatisch:

| Umgebung | Zahlungsweg |
|---|---|
| Web, Android-App | Stripe Checkout – unverändert (AGB, Widerruf, Kündigungsbutton § 312k) |
| iOS-App mit `REVENUECAT_IOS_API_KEY` | Apple In-App-Kauf (StoreKit) über RevenueCat, Preise aus dem App Store, „Käufe wiederherstellen“ |
| iOS-App mit `IOS_EXTERNAL_PURCHASE_EU=1` | Apple-konformer Hinweis „Du verlässt die App“ → Kauf im System-Browser (nur mit Apple-Berechtigung *StoreKit External Purchase* für die EU) |
| iOS-App ohne beides | neutraler Hinweis ohne Kauf-Link, bestehende Abos gelten |

Einrichtung In-App-Kauf:

1. In App Store Connect vier Auto-Renewable-Abos in einer Abo-Gruppe anlegen (Preise passend zu Web: 4,99 €/49 € bzw. 9,99 €/99 €):
   `de.pokeswiperadar.premium.monthly`, `de.pokeswiperadar.premium.yearly`, `de.pokeswiperadar.pro.monthly`, `de.pokeswiperadar.pro.yearly`
   (andere IDs über `IOS_PRODUCT_IDS` als JSON, z. B. `{"meine.id":{"plan":"pro","interval":"month"}}`).
2. Bei [RevenueCat](https://www.revenuecat.com) ein Projekt anlegen, die App-Store-App verbinden, die Produkte einer
   „Current Offering“ zuordnen.
3. Netlify-Umgebungsvariablen setzen: `REVENUECAT_IOS_API_KEY` (öffentlicher SDK-Schlüssel, beginnt mit `appl_`) und
   `REVENUECAT_WEBHOOK_AUTH` (frei gewähltes Geheimnis).
4. In RevenueCat unter *Integrations → Webhooks* die URL `https://pokeswipe-radar.de/api/billing/revenuecat/webhook` mit
   dem Authorization-Header `Bearer <REVENUECAT_WEBHOOK_AUTH>` eintragen. Sandbox-Käufe zählen nur mit `REVENUECAT_ALLOW_SANDBOX=1`.
5. `npm run cap:sync` – das Plugin `@revenuecat/purchases-capacitor` ist bereits in `package.json`.

Apple-Abos werden im Profil als `plan_source = apple` geführt; ein beendetes Stripe-Abo überschreibt sie nicht. Gekündigt
werden sie in den iPhone-Einstellungen (Apple-ID → Abonnements) – der Kündigungsbutton im Web weist darauf hin.

## Lokal gegen einen Deploy-Preview testen

```bash
CAP_SERVER_URL=https://deploy-preview-123--pokeswipe-radar.netlify.app npm run cap:sync
```
