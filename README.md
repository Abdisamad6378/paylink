# PayLink

A lightweight Node.js API that integrates Safaricom's Daraja API to initiate M-Pesa STK Push (Lipa Na M-Pesa Online) payments.

## How it works

PayLink exposes a few endpoints that let you trigger STK Push requests straight to a customer's phone. The flow looks like this:

1. You hit the `/api/mpesa/stkpush` endpoint with a phone number and amount
2. The server grabs an OAuth token from Daraja (cached so we don't hammer their API)
3. It builds the STK Push payload — shortcode, password, timestamp, callback URL, the works
4. Safaricom sends a push notification to the customer's phone asking them to enter their PIN
5. Once the customer confirms, Daraja hits your callback URL with the result

## Endpoints

| Method | Path | What it does |
|--------|------|--------------|
| GET | `/api/health` | Shows whether M-Pesa credentials are set and which environment you're on |
| GET | `/api/mpesa/token` | Fetches a fresh OAuth token and returns a preview (useful for testing) |
| POST | `/api/mpesa/stkpush` | Sends an STK Push. Needs `phoneNumber`, `amount`, and optionally `accountReference` and `transactionDesc` in the body |

## Getting started

```bash
git clone https://github.com/Abdisamad6378/paylink.git
cd paylink
npm install
```

Copy `.env.example` to `.env` and fill in your Daraja sandbox or production credentials:

```
MPESA_CONSUMER_KEY=your_consumer_key
MPESA_CONSUMER_SECRET=your_consumer_secret
MPESA_SHORTCODE=174379
MPESA_PASSKEY=your_passkey
MPESA_CALLBACK_URL=https://your-ngrok-url.ngrok-free.app/api/mpesa/callback
MPESA_ENV=sandbox
PORT=3000
```

Then:

```bash
npm run dev
```

## What's missing

- The callback endpoint (`/api/mpesa/callback`) isn't implemented yet — the API will send transaction results there but there's nothing listening
- No database or persistence — payments are fire-and-forget for now

## Built with

- [Express](https://expressjs.com/) — routing
- [Axios](https://axios-http.com/) — HTTP calls to Daraja
- [dotenv](https://github.com/motdotla/dotenv) — env management
