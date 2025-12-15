# 🔍 Production Notification Debugging Guide

## Masalah: Notifikasi tidak terkirim di production padahal:
- ✅ Device token sudah ada di database
- ✅ Perizinan notifikasi sudah diberikan
- ✅ Di Expo development bisa menerima notifikasi

## 🔎 Analisa Masalah

### 1. **Expo Access Token (PENTING!)**
**Status:** ⚠️ WAJIB di-set di production

**Cek:**
```bash
# Di server backend, cek .env
cat BACKEND_VERKAS/.env | grep EXPO_ACCESS_TOKEN
```

**Jika tidak ada atau kosong:**
1. Login ke https://expo.dev
2. Account Settings → Access Tokens
3. Create Token baru
4. Copy token (format: `exp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx`)
5. Tambahkan ke `.env`:
   ```env
   EXPO_ACCESS_TOKEN=exp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```
6. **RESTART backend server**

**Verifikasi:**
- Backend log harus TIDAK muncul warning: `⚠️ WARNING: EXPO_ACCESS_TOKEN not set`

---

### 2. **Project ID Mismatch**
**Kemungkinan:** Project ID di production build berbeda dengan development

**Cek di frontend:**
- Di `app.json`: `"projectId": "e29bb127-7cee-457b-91eb-c02e54f882de"`
- Di production build, cek log saat register token:
  ```
  🔑 ProjectId from Constants.expoConfig.extra.eas.projectId: ...
  ```

**Solusi:**
- Pastikan Project ID sama antara development dan production
- Jika berbeda, update `app.json` dan rebuild app

---

### 3. **Token Format Issue**
**Kemungkinan:** Token di production berbeda format

**Cek:**
- Token harus format: `ExponentPushToken[xxxxxxxxxxxxx]`
- Bukan: `ExpoPushToken[...]` atau format lain

**Debug:**
- Panggil endpoint: `GET /api/notifications/status`
- Cek field `format_check` dan `is_valid`

---

### 4. **Firebase Configuration (Android)**
**Status:** ✅ Sudah ada `google-services.json`

**Cek:**
- File `VERKAS/android/app/google-services.json` harus ada
- Package name harus match: `com.verkas.app`
- Firebase project harus aktif

**Verifikasi:**
- Cek di Firebase Console: https://console.firebase.google.com
- Project: `verkas-c342f`
- Pastikan Cloud Messaging API enabled

---

### 5. **Build Type Issue**
**Kemungkinan:** Standalone build vs EAS Build

**Cek:**
- Apakah menggunakan EAS Build atau standalone?
- EAS Build: Token biasanya lebih reliable
- Standalone: Perlu konfigurasi tambahan

**Solusi:**
- Gunakan EAS Build untuk production:
  ```bash
  eas build --platform android --profile production
  ```

---

### 6. **Notification Channel (Android)**
**Kemungkinan:** Notification channel belum dikonfigurasi

**Cek di frontend:**
- Di `app.json`, plugin `expo-notifications` sudah ada
- Icon dan color sudah dikonfigurasi

**Solusi:**
- Pastikan plugin config benar:
  ```json
  [
    "expo-notifications",
    {
      "icon": "./assets/icon.png",
      "color": "#ffffff"
    }
  ]
  ```

---

### 7. **APNs Configuration (iOS)**
**Status:** ⚠️ Perlu credentials untuk iOS production

**Cek:**
- Apakah build iOS atau Android?
- Jika iOS, perlu:
  - APNs Key atau Certificate
  - Apple Developer Account
  - Push Notification capability enabled

---

## 🛠️ Debugging Steps

### Step 1: Cek Backend Configuration
```bash
# Di server backend
curl https://verkas.bosgilserver.cloud/api/notifications/status \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Expected response:**
```json
{
  "success": true,
  "data": {
    "backend_config": {
      "hasExpoAccessToken": true,  // ← HARUS true
      "nodeEnv": "production",
      "expoAccessTokenLength": 40   // ← Harus > 0
    },
    "tokens": [...]
  }
}
```

### Step 2: Test Send Notification
```bash
curl -X POST https://verkas.bosgilserver.cloud/api/notifications/test-send \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "Test", "body": "Test notification"}'
```

**Cek response:**
- `sent`: harus > 0
- `tickets`: cek error details jika ada

### Step 3: Cek Backend Logs
**Cari di log:**
- `✅ Notification sent` → Berhasil
- `⚠️ Notification failed` → Gagal, cek error details
- `❌ CRITICAL: Ticket errors` → Ada error dari Expo API

**Error yang perlu diperhatikan:**
- `DeviceNotRegistered` → Token expired/invalid
- `InvalidCredentials` → EXPO_ACCESS_TOKEN salah
- `MessageTooBig` → Notifikasi terlalu besar

---

## 🔧 Quick Fixes

### Fix 1: Set EXPO_ACCESS_TOKEN
```bash
# Di server backend
cd /www/wwwroot/BackEnd-Verkas-With-ExpressJS
nano .env

# Tambahkan:
EXPO_ACCESS_TOKEN=exp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Restart
pm2 restart all
```

### Fix 2: Re-register Device Token
1. Uninstall app dari device
2. Install ulang
3. Login ulang (akan auto-register token baru)

### Fix 3: Check Token Validity
```sql
-- Di database, cek token format
SELECT 
  id, 
  user_id, 
  device_token, 
  platform,
  is_active,
  created_at
FROM device_tokens 
WHERE user_id = YOUR_USER_ID
ORDER BY created_at DESC;
```

**Pastikan:**
- `device_token` format: `ExponentPushToken[...]`
- `is_active` = `true`
- `platform` = `android` atau `ios`

---

## 📋 Checklist Production

- [ ] EXPO_ACCESS_TOKEN sudah di-set di `.env` backend
- [ ] Backend sudah restart setelah set EXPO_ACCESS_TOKEN
- [ ] Project ID sama antara dev dan production
- [ ] Firebase `google-services.json` ada dan valid (Android)
- [ ] APNs credentials sudah dikonfigurasi (iOS)
- [ ] App sudah di-build dengan EAS Build (bukan standalone)
- [ ] Device token format valid (`ExponentPushToken[...]`)
- [ ] Token `is_active` = `true` di database
- [ ] Test send notification berhasil (cek endpoint `/test-send`)

---

## 🆘 Jika Masih Gagal

1. **Cek Expo Dashboard:**
   - Login ke https://expo.dev
   - Cek project: `e29bb127-7cee-457b-91eb-c02e54f882de`
   - Cek apakah ada error atau rate limit

2. **Cek Backend Logs:**
   - Cari error: `❌ CRITICAL: Ticket errors`
   - Cek detail error dari Expo API

3. **Test dengan Expo CLI:**
   ```bash
   npx expo send-notification \
     --to ExponentPushToken[YOUR_TOKEN] \
     --title "Test" \
     --body "Test notification"
   ```

4. **Contact Support:**
   - Expo Support: https://expo.dev/support
   - Firebase Support: https://firebase.google.com/support

