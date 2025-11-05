# Quick Start Guide - Clerk + Paddle

Get up and running in 10 minutes!

## 1. Clerk Setup (3 minutes)

```bash
# 1. Sign up at https://clerk.com
# 2. Create new application
# 3. Copy keys to .env.local

NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_your_key_here
CLERK_SECRET_KEY=sk_test_your_key_here
```

**Enable Google OAuth** (optional):
- Dashboard → Social Connections → Enable Google

## 2. Paddle Setup (5 minutes)

```bash
# 1. Sign up at https://paddle.com
# 2. Switch to Sandbox mode
# 3. Create subscription product ($29/month)
# 4. Copy credentials to .env.local

NEXT_PUBLIC_PADDLE_ENVIRONMENT=sandbox
NEXT_PUBLIC_PADDLE_CLIENT_TOKEN=test_your_token_here
NEXT_PUBLIC_PADDLE_PRICE_ID=pri_your_price_id_here
PADDLE_WEBHOOK_SECRET=pdl_ntfset_your_secret_here
```

## 3. Test It (2 minutes)

```bash
# Start dev server
npm run dev

# Test auth
# → Go to http://localhost:3000/auth/signin
# → Sign in with Google

# Test payment (use test card: 4242 4242 4242 4242)
# → Go to http://localhost:3000/account
# → Click "Subscribe Now"
```

## 4. Set Up Webhooks (Local Testing)

```bash
# Install ngrok
npm install -g ngrok

# Expose your local server
ngrok http 3000

# Copy ngrok URL to Paddle webhook settings
# Example: https://abc123.ngrok.io/api/webhooks/paddle
```

## 5. Add Database (Required for Production)

See `CLERK_PADDLE_SETUP.md` for database schema and setup.

## That's it!

Check `CLERK_PADDLE_SETUP.md` for detailed production setup.

---

## Test Cards (Sandbox)

- Success: `4242 4242 4242 4242`
- Fails: `4000 0000 0000 0002`
- Any future date, any CVC

## Quick Links

- [Clerk Dashboard](https://dashboard.clerk.com)
- [Paddle Dashboard](https://vendors.paddle.com)
- [Full Setup Guide](./CLERK_PADDLE_SETUP.md)
