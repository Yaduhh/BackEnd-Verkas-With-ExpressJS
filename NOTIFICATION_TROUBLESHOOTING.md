# Troubleshooting Notifikasi VERKAS

## Checklist Debugging

### 1. Cek EXPO_ACCESS_TOKEN
```bash
# Di server, cek apakah EXPO_ACCESS_TOKEN sudah di-set
echo $EXPO_ACCESS_TOKEN

# Atau cek di .env file
cat .env | grep EXPO_ACCESS_TOKEN
```

**Cara mendapatkan EXPO_ACCESS_TOKEN:**
1. Login ke https://expo.dev
2. Buka Settings → Access Tokens
3. Buat token baru (jika belum ada)
4. Copy token dan tambahkan ke `.env`:
   ```
   EXPO_ACCESS_TOKEN=your_token_here
   ```

### 2. Cek Device Token Terdaftar

**Via API:**
```bash
# Cek status token user
GET /api/notifications/status
Authorization: Bearer <token>
```

**Response akan menampilkan:**
- Total tokens
- Active tokens
- Valid tokens
- Token format check
- Backend configuration

### 3. Test Send Notification

**Via API:**
```bash
POST /api/notifications/test
Authorization: Bearer <token>
Content-Type: application/json

{
  "title": "Test Notification",
  "body": "Ini adalah test notifikasi"
}
```

### 4. Cek Logs Backend

**Cek console logs untuk:**
- `📤 [BACKEND] EXPO SERVICE: Sending notification`
- `✅ [BACKEND] Ticket X: OK`
- `❌ [BACKEND] Ticket X ERROR:`

**Error yang sering muncul:**
- `DeviceNotRegistered` → Token expired atau app di-uninstall
- `InvalidCredentials` → EXPO_ACCESS_TOKEN salah atau expired
- `MessageTooBig` → Notifikasi terlalu besar (>4KB)
- `EAI_AGAIN` → DNS resolution error

### 5. Cek Frontend Logs

**Di app, cek console untuk:**
- `✅ [FRONTEND] EXPO TOKEN RECEIVED`
- `✅ [FRONTEND] Expo token registered to backend successfully`
- `📬 [FRONTEND] NOTIFICATION RECEIVED`

### 6. Cek DNS Resolution (Jika Error EAI_AGAIN)

**Test DNS:**
```bash
# Di server
nslookup exp.host
ping exp.host
```

**Solusi:**
- Set DNS server ke 8.8.8.8, 8.8.4.4 (Google DNS)
- Atau 1.1.1.1, 1.0.0.1 (Cloudflare DNS)

### 7. Cek Token Format

**Token Expo harus:**
- Format: `ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]`
- Panjang: ~50-60 karakter
- Harus valid Expo push token

**Cek via API:**
```bash
GET /api/notifications/status
```

### 8. Cek Permission di Device

**Android:**
- Settings → Apps → VERKAS → Notifications → ON

**iOS:**
- Settings → VERKAS → Notifications → Allow Notifications

### 9. Cek Project ID

**Di frontend (app.json):**
```json
{
  "expo": {
    "extra": {
      "eas": {
        "projectId": "e29bb127-7cee-457b-91eb-c02e54f882de"
      }
    }
  }
}
```

**Pastikan projectId harus sama di frontend dan backend.**

## Common Issues & Solutions

### Issue: Notifikasi tidak terkirim sama sekali

**Cek:**
1. EXPO_ACCESS_TOKEN sudah di-set?
2. Token sudah terdaftar di database?
3. Token format valid?
4. Ada error di backend logs?

**Solusi:**
- Set EXPO_ACCESS_TOKEN di .env
- Test send via `/api/notifications/test`
- Cek logs backend untuk error details

### Issue: Notifikasi terkirim tapi tidak muncul di device

**Cek:**
1. Permission notification sudah granted?
2. App sedang running atau background?
3. Notification channel sudah dibuat (Android)?

**Solusi:**
- Request permission di app
- Cek notification settings di device
- Test dengan app di background

### Issue: Error "DeviceNotRegistered"

**Penyebab:**
- Token expired
- App di-uninstall
- Token invalid

**Solusi:**
- Re-register device token
- Uninstall dan install ulang app
- Request token baru

### Issue: Error "InvalidCredentials"

**Penyebab:**
- EXPO_ACCESS_TOKEN salah
- EXPO_ACCESS_TOKEN expired

**Solusi:**
- Generate token baru di expo.dev
- Update .env dengan token baru
- Restart backend server

### Issue: Error "EAI_AGAIN" atau DNS error

**Penyebab:**
- DNS server tidak bisa resolve exp.host
- Network issue

**Solusi:**
- Set DNS server ke 8.8.8.8, 8.8.4.4
- Cek network connectivity
- Restart server

## Testing Steps

1. **Register Token:**
   - Login ke app
   - Token akan otomatis terdaftar

2. **Check Status:**
   ```bash
   GET /api/notifications/status
   ```

3. **Send Test:**
   ```bash
   POST /api/notifications/test
   ```

4. **Check Logs:**
   - Backend: Cek console untuk error
   - Frontend: Cek console untuk received notification

5. **Verify:**
   - Notifikasi muncul di device?
   - Notifikasi bisa di-tap?
   - Data notification benar?

## Support

Jika masih bermasalah, kirim:
1. Backend logs (error)
2. Frontend logs (console)
3. Response dari `/api/notifications/status`
4. Response dari `/api/notifications/test`
