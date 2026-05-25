const appConfigController = {
    getVersion: async (req, res) => {
        try {
            // Ambil dari environment variables (.env) dengan fallback nilai default
            const minVersionCode = parseInt(process.env.MIN_VERSION_CODE || '13', 10);
            const minVersion = process.env.MIN_VERSION || '3.1.0';
            const playStoreUrl = process.env.PLAY_STORE_URL || 'https://play.google.com/store/apps/details?id=com.verkas.app';
            const forceUpdate = (process.env.FORCE_UPDATE || 'true') === 'true';

            // Return response berformat JSON yang dinantikan oleh frontend
            res.json({
                minVersionCode,
                minVersion,
                playStoreUrl,
                forceUpdate
            });
        } catch (error) {
            console.error('Error fetching app config version:', error);
            res.status(500).json({ success: false, message: 'Internal server error' });
        }
    }
};

module.exports = appConfigController;
