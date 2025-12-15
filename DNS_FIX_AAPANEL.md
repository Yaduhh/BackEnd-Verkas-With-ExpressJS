# 🔧 Fix DNS Error (EAI_AGAIN) di aapanel

## Masalah
```
Error: getaddrinfo EAI_AGAIN exp.host
```

Ini berarti server tidak bisa resolve DNS untuk `exp.host` (Expo Push Notification Service).

---

## ✅ Solusi 1: Konfigurasi DNS di aapanel (RECOMMENDED)

### Langkah-langkah:

1. **Login ke aapanel**
   - Masuk ke aapanel dashboard

2. **Buka System Settings**
   - Klik menu **System** atau **Settings**
   - Pilih **DNS Settings** atau **Network Settings**

3. **Set DNS Servers**
   - Cari bagian **DNS Servers** atau **Nameservers**
   - Set DNS servers berikut:
     ```
     Primary DNS: 8.8.8.8 (Google DNS)
     Secondary DNS: 8.8.4.4 (Google DNS)
     Tertiary DNS: 1.1.1.1 (Cloudflare DNS)
     ```
   - Atau gunakan Cloudflare DNS:
     ```
     Primary DNS: 1.1.1.1
     Secondary DNS: 1.0.0.1
     ```

4. **Save dan Restart**
   - Klik **Save** atau **Apply**
   - **Restart server** atau restart network service

5. **Test DNS Resolution**
   ```bash
   # SSH ke server dan test
   nslookup exp.host
   # atau
   dig exp.host
   ```
   
   **Expected output:**
   ```
   exp.host has address 54.172.xxx.xxx
   ```

---

## ✅ Solusi 2: Konfigurasi DNS via SSH (Jika aapanel tidak support)

### Langkah-langkah:

1. **SSH ke server**
   ```bash
   ssh root@your-server-ip
   ```

2. **Edit resolv.conf**
   ```bash
   nano /etc/resolv.conf
   ```

3. **Tambahkan DNS servers**
   ```
   nameserver 8.8.8.8
   nameserver 8.8.4.4
   nameserver 1.1.1.1
   ```

4. **Save dan test**
   ```bash
   # Test DNS
   nslookup exp.host
   
   # Jika berhasil, restart Node.js app
   pm2 restart all
   ```

---

## ✅ Solusi 3: Konfigurasi DNS di Network Interface (CentOS/RHEL)

1. **Edit network config**
   ```bash
   nano /etc/sysconfig/network-scripts/ifcfg-eth0
   # atau
   nano /etc/sysconfig/network-scripts/ifcfg-ens33
   ```

2. **Tambahkan DNS**
   ```
   DNS1=8.8.8.8
   DNS2=8.8.4.4
   DNS3=1.1.1.1
   ```

3. **Restart network**
   ```bash
   systemctl restart network
   # atau
   service network restart
   ```

---

## ✅ Solusi 4: Konfigurasi DNS di Ubuntu/Debian

1. **Edit netplan config**
   ```bash
   nano /etc/netplan/01-netcfg.yaml
   ```

2. **Tambahkan DNS**
   ```yaml
   network:
     version: 2
     ethernets:
       eth0:
         dhcp4: true
         nameservers:
           addresses:
             - 8.8.8.8
             - 8.8.4.4
             - 1.1.1.1
   ```

3. **Apply config**
   ```bash
   netplan apply
   ```

---

## 🧪 Test DNS Resolution

Setelah konfigurasi, test dengan:

```bash
# Test 1: nslookup
nslookup exp.host

# Test 2: dig
dig exp.host

# Test 3: ping (untuk test connectivity)
ping -c 3 exp.host

# Test 4: curl (untuk test HTTP)
curl -I https://exp.host
```

**Expected:**
- `nslookup` dan `dig` harus return IP address
- `ping` harus berhasil (jika ICMP enabled)
- `curl` harus return HTTP 200 atau 404 (bukan connection error)

---

## 🔍 Verifikasi di Backend

Setelah konfigurasi DNS, cek di backend log:

1. **Restart backend:**
   ```bash
   pm2 restart all
   # atau
   systemctl restart your-backend-service
   ```

2. **Cek log saat send notification:**
   - Harus muncul: `✅ DNS resolution successful for exp.host`
   - Tidak boleh muncul: `❌ DNS resolution failed`

3. **Test send notification:**
   ```bash
   # Via API
   curl -X POST https://verkas.bosgilserver.cloud/api/notifications/test-send \
     -H "Authorization: Bearer YOUR_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"title": "Test", "body": "Test notification"}'
   ```

---

## ⚠️ Troubleshooting

### Masalah: DNS masih tidak resolve setelah konfigurasi

**Solusi:**
1. Cek apakah DNS servers benar-benar di-set:
   ```bash
   cat /etc/resolv.conf
   ```

2. Flush DNS cache:
   ```bash
   # CentOS/RHEL
   systemctl restart NetworkManager
   
   # Ubuntu/Debian
   systemd-resolve --flush-caches
   ```

3. Test dengan DNS server langsung:
   ```bash
   nslookup exp.host 8.8.8.8
   ```

### Masalah: Network interface tidak ditemukan

**Cek interface:**
```bash
ip addr show
# atau
ifconfig
```

Gunakan nama interface yang benar (biasanya `eth0`, `ens33`, `enp0s3`, dll)

---

## 📝 Catatan Penting

1. **DNS Configuration adalah perubahan sistem**, bukan aplikasi
2. **Restart server** mungkin diperlukan setelah perubahan DNS
3. **Backup config** sebelum mengubah DNS settings
4. **Test DNS resolution** sebelum restart production server
5. **Monitor logs** setelah perubahan untuk memastikan tidak ada masalah

---

## 🎯 Quick Checklist

- [ ] DNS servers sudah di-set (8.8.8.8, 8.8.4.4, atau 1.1.1.1)
- [ ] DNS config sudah di-save
- [ ] Server sudah di-restart (atau network service)
- [ ] DNS resolution test berhasil (`nslookup exp.host`)
- [ ] Backend sudah di-restart
- [ ] Test send notification berhasil

---

## 🆘 Jika Masih Gagal

1. **Cek firewall:**
   ```bash
   # Cek apakah port 53 (DNS) blocked
   iptables -L -n | grep 53
   ```

2. **Cek network connectivity:**
   ```bash
   # Test koneksi ke exp.host
   curl -v https://exp.host
   ```

3. **Contact hosting provider:**
   - Minta mereka untuk set DNS servers
   - Atau minta mereka untuk whitelist `exp.host`

4. **Alternative: Use IP directly (NOT RECOMMENDED)**
   - Dapatkan IP address dari `exp.host`
   - Update `/etc/hosts`:
     ```
     54.172.xxx.xxx exp.host
     ```
   - **Warning:** IP bisa berubah, jadi ini temporary fix saja

