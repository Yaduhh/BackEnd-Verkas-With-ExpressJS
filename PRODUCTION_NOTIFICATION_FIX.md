# 🔧 Fix: Production App Tidak Menerima Notifikasi

## Masalah
- ✅ Backend bisa mengirim notifikasi (tidak ada masalah DNS)
- ✅ Token dari production app valid
- ❌ Production app **TIDAK MENERIMA** notifikasi yang dikirim

---

## ✅ Perbaikan yang Sudah Dilakukan

### 1. **Android Notification Channel Setup** (CRITICAL)
Android 8.0+ memerlukan notification channel untuk menampilkan notifikasi. Tanpa channel, notifikasi tidak akan muncul.

**File:** `VERKAS/services/notificationService.ts`
```typescript
// CRITICAL: Setup notification channel for Android (production requirement)
if (Platform.OS === 'android') {
  Notifications.setNotificationChannelAsync('default', {
    name: 'Default',
    importance: Notifications.AndroidImportance.MAX, // Highest importance
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#FF231F7C',
    sound: 'default',
    enableVibrate: true,
    showBadge: true,
  }).catch(err => {
    console.warn('⚠️ Could not create notification channel:', err);
  });
}
```

### 2. **Enhanced Notification Handler**
Memastikan notifikasi selalu ditampilkan, bahkan saat app di foreground.

**File:** `VERKAS/services/notificationService.ts`
```typescript
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    // CRITICAL: Always show notification, even in foreground
    return {
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true, // Show banner even when app is open
      shouldShowList: true, // Show in notification list
    };
  },
});
```

### 3. **Enhanced Logging**
Menambahkan logging detail untuk debugging di production.

---

## 🧪 Testing di Production

### Step 1: Rebuild Production App
```bash
# Build production app dengan perubahan terbaru
eas build --platform android --profile production
# atau
eas build --platform ios --profile production
```

### Step 2: Install dan Test
1. Install production build di device fisik
2. Login ke app
3. Pastikan permission notifikasi granted
4. Cek log di device:
   ```bash
   # Android
   adb logcat | grep -i notification
   
   # iOS
   # Gunakan Xcode Console atau device logs
   ```

### Step 3: Test Send Notification
```bash
# Via API
curl -X POST https://verkas.bosgilserver.cloud/api/notifications/test-send \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "Test", "body": "Test notification from production"}'
```

### Step 4: Cek Logs
**Expected logs di production app:**
```
🔧 Setting up notification listeners...
✅ Notification listeners setup complete
📬 Notification received (foreground): {...}
📬 Notification tapped (background/quit): {...}
```

---

## 🔍 Troubleshooting

### Masalah: Notifikasi tidak muncul di Android

**Solusi:**
1. **Cek notification channel:**
   - Buka Settings → Apps → Verkas → Notifications
   - Pastikan channel "Default" ada dan enabled
   - Pastikan importance = "High" atau "Urgent"

2. **Cek app permissions:**
   ```bash
   # Android
   adb shell dumpsys package com.verkas.app | grep permission
   ```

3. **Cek notification settings di device:**
   - Settings → Apps → Verkas → Notifications
   - Pastikan "Allow notifications" enabled
   - Pastikan "Show on lock screen" enabled (optional)

### Masalah: Notifikasi tidak muncul di iOS

**Solusi:**
1. **Cek notification permissions:**
   - Settings → Verkas → Notifications
   - Pastikan "Allow Notifications" enabled
   - Pastikan "Lock Screen", "Notification Center", dan "Banners" enabled

2. **Cek background modes:**
   - Pastikan `UIBackgroundModes` includes `remote-notification` di `app.json`
   - ✅ Sudah ada: `"UIBackgroundModes": ["remote-notification"]`

3. **Cek capabilities di Xcode:**
   - Buka project di Xcode
   - Target → Signing & Capabilities
   - Pastikan "Push Notifications" enabled
   - Pastikan "Background Modes" → "Remote notifications" enabled

### Masalah: Notifikasi muncul tapi tidak bisa di-tap

**Solusi:**
1. **Cek notification listeners:**
   - Pastikan `setupNotificationHandlers()` dipanggil saat user login
   - Cek log: `✅ Notification listeners setup complete`

2. **Cek notification data:**
   - Pastikan backend mengirim `data` field dengan benar
   - Cek log: `📬 Notification tapped (background/quit): {...}`

---

## 📋 Checklist

- [ ] Android notification channel sudah dibuat (`setNotificationChannelAsync`)
- [ ] Notification handler sudah di-setup (`setNotificationHandler`)
- [ ] Notification listeners sudah di-setup (`setupListeners`)
- [ ] App permissions sudah granted (POST_NOTIFICATIONS untuk Android)
- [ ] Background modes enabled (iOS: `remote-notification`)
- [ ] Production build sudah di-rebuild dengan perubahan terbaru
- [ ] Test send notification berhasil
- [ ] Logs menunjukkan notification received/tapped

---

## 🎯 Key Points

1. **Android Notification Channel** adalah **REQUIREMENT** untuk Android 8.0+
   - Tanpa channel, notifikasi tidak akan muncul
   - Channel harus dibuat sebelum notifikasi pertama dikirim

2. **Notification Handler** harus selalu return `shouldShowAlert: true`
   - Ini memastikan notifikasi muncul bahkan saat app di foreground

3. **Notification Listeners** harus di-setup saat user login
   - `addNotificationReceivedListener` untuk foreground
   - `addNotificationResponseReceivedListener` untuk background/quit

4. **Production Build** harus di-rebuild setelah perubahan
   - Development build (Expo Go) berbeda dengan production build
   - Production build memerlukan native code compilation

---

## 🆘 Jika Masih Gagal

1. **Cek device logs:**
   ```bash
   # Android
   adb logcat | grep -i "notification\|expo"
   
   # iOS
   # Xcode → Window → Devices and Simulators → View Device Logs
   ```

2. **Test dengan Expo Push Notification Tool:**
   - https://expo.dev/notifications
   - Masukkan device token dari production app
   - Send test notification
   - Cek apakah muncul

3. **Cek backend logs:**
   - Pastikan notification berhasil dikirim ke Expo
   - Cek apakah ada error dari Expo API

4. **Contact Support:**
   - Expo: https://forums.expo.dev
   - GitHub: https://github.com/expo/expo/issues

