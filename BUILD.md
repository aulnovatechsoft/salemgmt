# BSNL Sales & Event App - Build Guide

This guide explains how to build the Android APK for the BSNL Sales & Event App.

## Prerequisites

1. Node.js installed (v18 or higher)
2. Expo account (create at https://expo.dev)
3. EAS CLI installed globally

## Step 1: Install EAS CLI

```bash
npm install -g eas-cli
```

## Step 2: Login to Expo

```bash
eas login
```

Enter your Expo account credentials when prompted.

## Step 3: Configure EAS Build

Run the configuration command:

```bash
eas build:configure
```

This will create an `eas.json` file in your project root.

## Step 4: Update eas.json

Make sure your `eas.json` has these profiles:

```json
{
  "cli": {
    "version": ">= 3.0.0"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal",
      "android": {
        "buildType": "apk"
      }
    },
    "production": {
      "android": {
        "buildType": "app-bundle"
      }
    }
  },
  "submit": {
    "production": {}
  }
}
```

## Step 5: Configure Backend URL

Before building, set the production API URL in your app.

Create or update `.env` file:

```
EXPO_PUBLIC_RORK_API_BASE_URL=https://your-deployed-app-url.replit.app
```

Replace `your-deployed-app-url.replit.app` with your actual deployed Replit URL.

## Step 6: Build APK

### For Testing (APK file):

```bash
eas build --platform android --profile preview
```

This creates a downloadable APK file for testing on Android devices.

### For Production (Google Play Store):

```bash
eas build --platform android --profile production
```

This creates an AAB (Android App Bundle) file for Google Play Store submission.

## Step 7: Download the APK

After the build completes:
1. Go to your Expo dashboard (https://expo.dev)
2. Find your build
3. Download the APK file
4. Transfer to your Android device and install

## Alternative: Test with Expo Go

For quick testing without building:

1. Install "Expo Go" app on your Android phone
2. Run the development server: `npx expo start`
3. Scan the QR code with Expo Go app

## Troubleshooting

### Build fails with package errors
```bash
npm install
npx expo install --fix
```

### EAS not found
```bash
npm install -g eas-cli
```

### Authentication issues
```bash
eas logout
eas login
```

## Important Notes

1. The APK will only work with the deployed backend URL configured
2. For development testing, use Expo Go app
3. For production, deploy your backend first using Replit's Publish feature
4. Keep your Expo account credentials secure

## Build Profiles Summary

| Profile | Output | Use Case |
|---------|--------|----------|
| development | Development build | Testing with dev tools |
| preview | APK file | Internal testing on devices |
| production | AAB bundle | Google Play Store submission |

## Deployment Checklist

- [ ] Backend deployed and running on Replit
- [ ] EXPO_PUBLIC_RORK_API_BASE_URL set to production URL
- [ ] app.json configured with correct app name and bundle ID
- [ ] EAS Build configured
- [ ] Build completed successfully
- [ ] APK tested on real device
