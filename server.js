// server.js
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { getAccessToken, initiateSTKPush } = require('./mpesa');

const app = express();
app.use(cors());
app.use(express.json());

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    mpesa_configured: !!process.env.MPESA_CONSUMER_KEY && !!process.env.MPESA_CONSUMER_SECRET,
    environment: process.env.MPESA_ENV || 'not set',
  });
});

// Test OAuth
app.get('/api/mpesa/token', async (req, res) => {
  try {
    const startTime = Date.now();
    const token = await getAccessToken();
    const duration = Date.now() - startTime;

    res.json({
      success: true,
      token_preview: token.substring(0, 20) + '...',
      fetch_time_ms: duration,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Initiate STK Push
app.post('/api/mpesa/stkpush', async (req, res) => {
  try {
    const { phoneNumber, amount, accountReference, transactionDesc } = req.body;

    // Validate required fields
    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'Phone number is required',
      });
    }

    if (!amount || amount < 1) {
      return res.status(400).json({
        success: false,
        error: 'Amount must be at least 1 KES',
      });
    }

    // Format phone number: convert 07XX to 2547XX format
    let formattedPhone = String(phoneNumber).trim();
    if (formattedPhone.startsWith('0')) {
      formattedPhone = '254' + formattedPhone.substring(1);
    }
    if (formattedPhone.startsWith('+')) {
      formattedPhone = formattedPhone.substring(1);
    }

    // Validate phone number format
    if (!/^254[17]\d{8}$/.test(formattedPhone)) {
      return res.status(400).json({
        success: false,
        error:
          'Invalid phone number. Use format 254XXXXXXXXX (e.g., 254712345678)',
      });
    }

    console.log(`Initiating STK Push: ${formattedPhone}, KES ${amount}`);

    const result = await initiateSTKPush(
      formattedPhone,
      amount,
      accountReference || 'PayLink',
      transactionDesc || 'Payment'
    );

    res.json({
      success: true,
      message: 'STK Push sent. Check your phone for the M-Pesa prompt.',
      data: {
        MerchantRequestID: result.MerchantRequestID,
        CheckoutRequestID: result.CheckoutRequestID,
        ResponseCode: result.ResponseCode,
        ResponseDescription: result.ResponseDescription,
        CustomerMessage: result.CustomerMessage,
      },
    });
  } catch (error) {
    console.error('STK Push endpoint error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});