const { chatWithAI } = require('./aiController');

const chatWithAssistant = async (req, res, next) => {
  try {
    req.setTimeout(180000); // 3 minutes timeout to allow slow CPU-based Gemma 4 inference
    const { message, chatHistory, branchName } = req.body;
    const branchId = req.branchId; // Enforced via getCurrentBranch middleware

    if (!message) {
      return res.status(400).json({
        success: false,
        message: 'Pesan wajib diisi'
      });
    }

    let ownerId = req.userId;
    if (req.user && req.user.role !== 'owner' && req.user.created_by) {
      ownerId = req.user.created_by;
    }

    const Subscription = require('../models/Subscription');
    const subscription = await Subscription.getActiveSubscription(ownerId);

    if (!subscription || subscription.billing_period !== 'yearly') {
      return res.status(200).json({
        success: true,
        reply: 'silahkan upgrade paket ya'
      });
    }

    // Set branchId on req.body so chatWithAI can extract it
    req.body.branchId = branchId;

    console.log(`[Backend-Main] Calling local integrated AI Service directly...`);
    return await chatWithAI(req, res);

  } catch (error) {
    console.error('Error in integrated AI Service:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal memproses pesan dengan AI',
      error: error.message
    });
  }
};

module.exports = {
  chatWithAssistant
};
