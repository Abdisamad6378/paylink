const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { getAccessToken, initiateSTKPush, querySTKPushStatus } = require('./mpesa');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

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


// Helper function
function getCallbackValue(metadata, name) {
  const item = metadata.Item.find((entry) => entry.Name === name);
  return item ? item.Value : null;
}


// Query payment status from Daraja
app.get('/api/mpesa/status/:checkoutRequestId', async (req, res) => {
  try {
    const { checkoutRequestId } = req.params;

    // First check our database
    const payment = await prisma.payment.findUnique({
      where: { checkoutRequestId },
    });

    if (!payment) {
      return res.status(404).json({
        success: false,
        error: 'Payment not found',
      });
    }

    // If the payment is already completed or failed, return the stored result
    if (payment.status === 'completed' || payment.status === 'failed' || payment.status === 'cancelled') {
      return res.json({
        success: true,
        data: {
          status: payment.status,
          resultCode: payment.resultCode,
          resultDesc: payment.resultDesc,
          mpesaReceiptNumber: payment.mpesaReceiptNumber,
          amount: payment.amount,
          phoneNumber: payment.phoneNumber,
        },
      });
    }

    // If still pending, query Daraja for the latest status
    try {
      const queryResult = await querySTKPushStatus(checkoutRequestId);
      const resultCode = parseInt(queryResult.ResultCode, 10);

      if (resultCode === 0) {
        // Payment completed -- update database
        await prisma.payment.update({
          where: { checkoutRequestId },
          data: {
            status: 'completed',
            resultCode: resultCode,
            resultDesc: queryResult.ResultDesc,
          },
        });

        return res.json({
          success: true,
          data: {
            status: 'completed',
            resultCode: resultCode,
            resultDesc: queryResult.ResultDesc,
            amount: payment.amount,
            phoneNumber: payment.phoneNumber,
          },
        });
      } else if (resultCode === 1032) {
        await prisma.payment.update({
          where: { checkoutRequestId },
          data: {
            status: 'cancelled',
            resultCode: resultCode,
            resultDesc: queryResult.ResultDesc,
          },
        });

        return res.json({
          success: true,
          data: { status: 'cancelled', resultCode, resultDesc: queryResult.ResultDesc },
        });
      } else {
        // Other failure
        await prisma.payment.update({
          where: { checkoutRequestId },
          data: {
            status: 'failed',
            resultCode: resultCode,
            resultDesc: queryResult.ResultDesc,
          },
        });

        return res.json({
          success: true,
          data: { status: 'failed', resultCode, resultDesc: queryResult.ResultDesc },
        });
      }
    } catch (queryError) {
      // Query failed -- the payment might still be processing
      return res.json({
        success: true,
        data: {
          status: 'pending',
          message: 'Payment is still being processed. Try again in a few seconds.',
        },
      });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// server.js - add this endpoint

// Poll payment status by payment ID
app.get('/api/payments/:id/poll', async (req, res) => {
  try {
    const payment = await prisma.payment.findUnique({
      where: { id: req.params.id },
    });

    if (!payment) {
      return res.status(404).json({ success: false, error: 'Payment not found' });
    }

    // If already resolved, return immediately
    if (payment.status !== 'pending') {
      return res.json({
        success: true,
        data: {
          status: payment.status,
          mpesaReceiptNumber: payment.mpesaReceiptNumber,
          resultDesc: payment.resultDesc,
          amount: payment.amount,
        },
      });
    }

    // Still pending -- try querying Daraja
    try {
      const queryResult = await querySTKPushStatus(payment.checkoutRequestId);
      const resultCode = parseInt(queryResult.ResultCode, 10);

      let status = 'pending';
      if (resultCode === 0) status = 'completed';
      else if (resultCode === 1032) status = 'cancelled';
      else if (resultCode !== 1) status = 'failed'; // 1 might mean still processing

      if (status !== 'pending') {
        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            status,
            resultCode,
            resultDesc: queryResult.ResultDesc,
          },
        });
      }

      return res.json({
        success: true,
        data: {
          status,
          resultDesc: queryResult.ResultDesc,
          amount: payment.amount,
        },
      });
    } catch (queryError) {
      // Query failed, still pending
      return res.json({
        success: true,
        data: { status: 'pending' },
      });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Idempotent callback handler
app.post('/api/mpesa/callback', async (req, res) => {
  res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });

  try {
    const { stkCallback } = req.body.Body;
    const { CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata } = stkCallback;

    // Check if this payment has already been processed
    const existingPayment = await prisma.payment.findUnique({
      where: { checkoutRequestId: CheckoutRequestID },
    });

    if (!existingPayment) {
      console.warn(`Callback for unknown CheckoutRequestID: ${CheckoutRequestID}`);
      return;
    }

    // If already processed (not pending), skip
    if (existingPayment.status !== 'pending') {
      console.log(
        `Duplicate callback for ${CheckoutRequestID}. Already ${existingPayment.status}. Skipping.`
      );
      return;
    }

    // Process the callback
    if (ResultCode === 0) {
      const receipt = getCallbackValue(CallbackMetadata, 'MpesaReceiptNumber');
      const transactionDate = getCallbackValue(CallbackMetadata, 'TransactionDate');

      await prisma.payment.update({
        where: { checkoutRequestId: CheckoutRequestID },
        data: {
          status: 'completed',
          resultCode: ResultCode,
          resultDesc: ResultDesc,
          mpesaReceiptNumber: receipt,
          transactionDate: String(transactionDate),
        },
      });

      console.log(`Payment completed: ${CheckoutRequestID}, Receipt: ${receipt}`);
    } else {
      const status = ResultCode === 1032 ? 'cancelled' : 'failed';

      await prisma.payment.update({
        where: { checkoutRequestId: CheckoutRequestID },
        data: {
          status,
          resultCode: ResultCode,
          resultDesc: ResultDesc,
        },
      });

      console.log(`Payment ${status}: ${CheckoutRequestID}, Reason: ${ResultDesc}`);
    }
  } catch (error) {
    console.error('Callback processing error:', error.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});