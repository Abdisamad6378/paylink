// error-handler.js

/**
 * Get a user-friendly message for an M-Pesa error code.
 */
function getMpesaErrorMessage(resultCode) {
  const messages = {
    0: 'Payment completed successfully.',
    1: 'You do not have enough money in your M-Pesa account. Please top up and try again.',
    1001: 'Your phone is busy with another M-Pesa transaction. Wait a moment and try again.',
    1019: 'The payment request expired. Please try again.',
    1032: 'You cancelled the payment. If this was a mistake, click Pay again.',
    1037: 'You did not enter your PIN in time. The request has expired. Please try again.',
    2001: 'You entered the wrong M-Pesa PIN. Please try again and enter the correct PIN.',
    9999: 'M-Pesa is experiencing a temporary issue. Please try again in a few minutes.',
  };

  return messages[resultCode] || `Payment failed (error code: ${resultCode}). Please try again.`;
}

module.exports = { getMpesaErrorMessage };