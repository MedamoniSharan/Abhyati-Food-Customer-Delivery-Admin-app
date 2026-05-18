# Abhyati Delivery (driver)

Separate Capacitor + Vite app for delivery drivers. It talks to the **same backend** as the customer app (`/api/zoho/delivery/*`).

## Run (web)

```bash
npm install
npm run dev
```

## Build & Android

```bash
npm run build
npx cap sync android
```

Open `android/` in Android Studio. The manifest already declares **INTERNET**, **CAMERA** (QR / proof of delivery), **ACCESS_FINE_LOCATION**, **ACCESS_COARSE_LOCATION**, and optional camera hardware flags.

## iOS

After `npx cap add ios` and `npx cap sync ios`, add these keys to `ios/App/App/Info.plist` (Xcode target → Info):

- **NSCameraUsageDescription** — Scan QR codes and capture proof of delivery.
- **NSPhotoLibraryUsageDescription** — Attach delivery photos when you add that flow.
- **NSLocationWhenInUseUsageDescription** — Show route preview with your position on the in-app map.

## Environment

See `.env.example` (`VITE_API_BASE_URL`, optional `VITE_GOOGLE_MAPS_API_KEY` for embedded Maps).
