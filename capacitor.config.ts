// Phase 4: Native App (iOS & Android) als Capacitor-Hülle um die Live-Web-App.
// Die App lädt pokeswipe-radar.de – so gelten Login (Netlify Identity), API, Zahlungen und Updates ohne App-Store-Release.
// Ohne Netz zeigt der Service Worker die zwischengespeicherte App; fehlt auch die, startet die gebündelte Kopie aus /public.
//
//   npm run cap:add        einmalig: ios/ und android/ anlegen + Berechtigungen eintragen
//   npm run cap:sync       nach Änderungen an Plugins/Konfiguration
//   npm run cap:ios        Xcode öffnen (Signieren, Archivieren, App Store Connect)
//   npm run cap:android    Android Studio öffnen (Bundle für Google Play bauen)
//
// Details: native/README.md
import type { CapacitorConfig } from "@capacitor/cli";

const SERVER_URL = process.env.CAP_SERVER_URL || "https://pokeswipe-radar.de";

const config: CapacitorConfig = {
  appId: "de.pokeswiperadar.app",
  appName: "PokeSwipe",
  webDir: "public",
  backgroundColor: "#070a14",
  server: {
    url: SERVER_URL,
    cleartext: false,
    androidScheme: "https",
    // Diese Seiten bleiben in der App (Login-Bestätigung, Stripe-Checkout für den Marktplatz mit physischen Karten,
    // Stripe-Verifizierung für Verkäufer). Digitale Abos laufen in der iOS-App NICHT über Stripe (client/payments.js).
    allowNavigation: ["pokeswipe-radar.de", "*.pokeswipe-radar.de", "pokeswipe-radar.netlify.app", "checkout.stripe.com", "connect.stripe.com", "*.stripe.com"],
    errorPath: "404.html",
  },
  ios: {
    // Randlos bis unter Dynamic Island/Notch – die Abstände übernimmt das CSS über env(safe-area-inset-*) (public/theme.css)
    contentInset: "never",
    scheme: "PokeSwipe",
    limitsNavigationsToAppBoundDomains: false,
    preferredContentMode: "mobile",
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    PushNotifications: { presentationOptions: ["badge", "sound", "alert"] },
    SplashScreen: { launchShowDuration: 900, backgroundColor: "#070a14", showSpinner: false, androidScaleType: "CENTER_CROP" },
    // Phase 9: native Integrationen (client/native.js) – Status-Leiste dunkel, Kamera-Oberfläche, Haptik, Teilen-Sheet
    StatusBar: { style: "DARK", overlaysWebView: true, backgroundColor: "#00000000" },
    Camera: { presentationStyle: "fullscreen" },
  },
};

export default config;
