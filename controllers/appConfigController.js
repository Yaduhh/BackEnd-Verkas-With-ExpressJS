const { query } = require('../config/database');

const appConfigController = {
    getVersion: async (req, res) => {
        try {
            // Ambil dari environment variables (.env) dengan fallback nilai default
            const minVersionCode = parseInt(process.env.MIN_VERSION_CODE || '13', 10);
            const minVersion = process.env.MIN_VERSION || '3.1.0';
            const playStoreUrl = process.env.PLAY_STORE_URL || 'https://play.google.com/store/apps/details?id=com.verkas.app';
            const forceUpdate = (process.env.FORCE_UPDATE || 'true') === 'true';

            // Ambil status asisten AI dari database
            let enableAiAssistant = false;
            try {
                const aiResult = await query("SELECT value FROM system_settings WHERE `key` = 'enable_ai_assistant'");
                if (aiResult.length > 0) {
                    enableAiAssistant = JSON.parse(aiResult[0].value);
                }
            } catch (dbErr) {
                console.error('Error fetching enable_ai_assistant from DB:', dbErr);
            }

            // Return response berformat JSON yang dinantikan oleh frontend
            res.json({
                minVersionCode,
                minVersion,
                playStoreUrl,
                forceUpdate,
                enableAiAssistant
            });
        } catch (error) {
            console.error('Error fetching app config version:', error);
            res.status(500).json({ success: false, message: 'Internal server error' });
        }
    }
};

module.exports = appConfigController;
