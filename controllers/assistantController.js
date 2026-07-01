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

    const aiServiceUrl = process.env.AI_SERVICE_URL || 'http://localhost:5005';
    console.log(`[Backend-Main] Forwarding request to AI Service: ${aiServiceUrl}/api/ai/chat`);

    const response = await fetch(`${aiServiceUrl}/api/ai/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message,
        chatHistory,
        branchId,
        branchName
      })
    });

    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.message || 'Gagal terhubung ke AI Service');
    }

    return res.status(200).json(data);

  } catch (error) {
    console.error('Error forwarding to AI Service:', error);
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
