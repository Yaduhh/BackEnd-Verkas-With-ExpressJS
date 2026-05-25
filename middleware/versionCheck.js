/**
 * Middleware untuk memvalidasi versi aplikasi klien (mobile app) secara paksa.
 * Membaca header 'x-app-version-code' yang dikirim dari aplikasi mobile.
 * Jika request datang dari mobile (tidak memiliki origin header) dan versinya di bawah ketentuan,
 * request akan langsung ditolak sebelum mengakses database.
 */
const versionCheck = (req, res, next) => {
    // 1. Lewati pengecekan untuk route publik & asset static agar tidak terganggu
    const path = req.path;
    if (
        path.startsWith('/api/app-config') || 
        path.startsWith('/uploads') || 
        path === '/health' ||
        path === '/favicon.ico'
    ) {
        return next();
    }

    const origin = req.headers.origin;
    const clientVersionCodeHeader = req.headers['x-app-version-code'];
    const clientVersionCode = parseInt(clientVersionCodeHeader || '0', 10);
    const minVersionCode = parseInt(process.env.MIN_VERSION_CODE || '13', 10);
    const forceUpdate = (process.env.FORCE_UPDATE || 'true') === 'true';

    if (process.env.NODE_ENV === 'development') {
        console.log(`🔍 [VersionCheck Debug] Path: ${path} | Origin: ${origin || 'none'} | ClientVersion: ${clientVersionCodeHeader || 'none'} (${clientVersionCode}) | MinRequired: ${minVersionCode} | Force: ${forceUpdate}`);
    }

    // 2. Jika request berasal dari aplikasi mobile (tidak ada origin)
    if (!origin) {
        // 3. Blokir jika forceUpdate aktif dan versionCode klien lebih kecil dari syarat minimum
        // Jika clientVersionCodeHeader tidak dikirim (artinya user masih pakai app build lama sebelum ada middleware),
        // clientVersionCode akan bernilai 0, sehingga otomatis juga akan terblokir!
        if (forceUpdate && clientVersionCode < minVersionCode) {
            console.log(`❌ [VersionBlocker] Blocking outdated client: ${clientVersionCode} < ${minVersionCode}`);
            return res.status(426).json({
                success: false,
                code: 'UPDATE_REQUIRED',
                message: 'Versi aplikasi Anda sudah tidak didukung. Silakan perbarui aplikasi Verkas Anda di Google Play Store untuk dapat melanjutkan.',
                playStoreUrl: process.env.PLAY_STORE_URL || 'https://play.google.com/store/apps/details?id=com.verkas.app'
            });
        }
    }

    next();
};

module.exports = versionCheck;
