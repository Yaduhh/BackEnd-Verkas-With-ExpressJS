# 🔥 Setup FCM (Firebase Cloud Messaging) Langsung

## 📋 Overview

Sekarang backend support **FCM langsung** tanpa perlu Expo Push Notification Service. Backend akan otomatis coba FCM dulu, kalau gagal baru fallback ke Expo.

---

## 🔧 Backend Setup

### 1. Install Dependencies

```bash
cd BACKEND_VERKAS
npm install firebase-admin
```

### 2. Download Firebase Service Account

1. Buka [Firebase Console](https://console.firebase.google.com/)
2. Pilih project **verkas-c342f** (atau project kamu)
3. Klik **Settings** (⚙️) → **Project settings**
4. Tab **Service accounts**
5. Klik **Generate new private key**
6. Download file JSON (contoh: `verkas-c342f-firebase-adminsdk-xxxxx.json`)

### 3. Setup Service Account

**Option 1: Pakai File (Recommended)**
1. Copy file JSON ke `BACKEND_VERKAS/config/firebase-service-account.json`
2. Tambahkan ke `.env`:
   ```env
   FCM_SERVICE_ACCOUNT_PATH=./config/firebase-service-account.json
   ```

**Option 2: Pakai Environment Variable**
1. Copy isi file JSON
2. Tambahkan ke `.env` (sebagai JSON string):
   ```env
   FCM_SERVICE_ACCOUNT_KEY={"type":"service_account","project_id":"verkas-c342f",...}
   ```

### 4. Update `.env`

```env
# Firebase Cloud Messaging (FCM) - REQUIRED for direct FCM
FCM_SERVICE_ACCOUNT_PATH=./config/firebase-service-account.json
# ATAU
# FCM_SERVICE_ACCOUNT_KEY={"type":"service_account",...}
```

### 5. Restart Backend

```bash
npm run dev
# atau
pm2 restart all
```

**Expected log:**
```
✅ Firebase Admin SDK initialized from service account file
```

---

## 📱 Frontend Setup

### Option A: Pakai @react-native-firebase/messaging (Recommended untuk FCM langsung)

**⚠️ PENTING:** Ini perlu **development build** atau **eject dari Expo managed workflow**.

#### 1. Install Dependencies

```bash
cd VERKAS
npm install @react-native-firebase/app @react-native-firebase/messaging
```

#### 2. Update `app.json`

```json
{
  "expo": {
    "plugins": [
      [
        "@react-native-firebase/app",
        {
          "android": {
            "googleServicesFile": "./android/app/google-services.json"
          }
        }
      ],
      [
        "@react-native-firebase/messaging"
      ]
    ]
  }
}
```

#### 3. Update `notificationService.ts`

Ganti `getExpoPushTokenAsync` dengan FCM token:

```typescript
import messaging from '@react-native-firebase/messaging';

// Ganti registerDeviceToken() dengan:
async registerDeviceToken(): Promise<string | null> {
  const hasPermission = await this.requestPermissions();
  if (!hasPermission) {
    throw new Error('Notification permission not granted');
  }

  try {
    // Get FCM token directly
    const fcmToken = await messaging().getToken();
    console.log('✅ FCM token received:', fcmToken);

    // Send token to backend
    await api.post('/notifications/register', {
      device_token: fcmToken,
      platform: Platform.OS,
      device_name: Device.modelName || 'Unknown',
      app_version: Constants.expoConfig?.version || '1.0.0',
    });

    return fcmToken;
  } catch (error) {
    console.error('❌ Error getting FCM token:', error);
    return null;
  }
}
```

#### 4. Rebuild App

```bash
npx expo prebuild --clean
npx expo run:android
# atau
eas build --platform android --profile production
```

---

### Option B: Tetap Pakai Expo (Hybrid - Backend Support Both)

Jika tetap pakai Expo managed workflow, backend akan otomatis detect token format:
- **Expo token** → Kirim via Expo Push Service
- **FCM token** → Kirim langsung via FCM

Frontend tidak perlu diubah, tetap pakai `expo-notifications`.

---

## 🧪 Testing

### 1. Test FCM Service

```bash
# Via API
curl -X POST https://verkas.bosgilserver.cloud/api/notifications/test-send \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "Test FCM", "body": "Test notification via FCM"}'
```

### 2. Cek Backend Logs

**Expected (FCM success):**
```
📤 Sending FCM notification to user 1: "Test FCM" - 1/1 valid device(s)
✅ FCM notification sent: 1/1 successful
```

**Expected (FCM failed, fallback to Expo):**
```
⚠️ FCM service failed, falling back to Expo: ...
📤 Sending notification to user 1: "Test FCM" - 1/1 valid device(s)
```

### 3. Cek Token Format

```bash
# Via API
curl -X GET https://verkas.bosgilserver.cloud/api/notifications/status \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "tokens": [
      {
        "format_check": "valid_fcm_format",  // atau "valid_expo_format"
        "is_valid": true
      }
    ]
  }
}
```

---

## 🔍 Troubleshooting

### Error: "Firebase Admin SDK not initialized"

**Solusi:**
1. Cek `FCM_SERVICE_ACCOUNT_PATH` atau `FCM_SERVICE_ACCOUNT_KEY` di `.env`
2. Pastikan file JSON ada dan valid
3. Restart backend

### Error: "Invalid token format"

**Solusi:**
- Pastikan frontend mengirim FCM token (bukan Expo token)
- FCM token biasanya panjang (152+ karakter), tidak ada prefix

### Error: "messaging/invalid-registration-token"

**Solusi:**
- Token sudah expired atau invalid
- Backend akan otomatis deactivate token
- User perlu register token baru

---

## 📝 Notes

1. **Backend Support Both:** Backend otomatis detect token format dan pakai service yang sesuai
2. **FCM First:** Backend akan coba FCM dulu, kalau gagal baru fallback ke Expo
3. **No Breaking Changes:** Frontend yang pakai Expo token tetap bisa bekerja
4. **Production Ready:** FCM lebih reliable dan tidak perlu Expo Access Token

---

## ✅ Checklist

- [ ] `firebase-admin` installed di backend
- [ ] Firebase service account JSON downloaded
- [ ] `FCM_SERVICE_ACCOUNT_PATH` atau `FCM_SERVICE_ACCOUNT_KEY` set di `.env`
- [ ] Backend restarted
- [ ] Frontend updated (jika pakai Option A)
- [ ] Test send notification berhasil
- [ ] Backend logs menunjukkan FCM service digunakan

