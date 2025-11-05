# 🍋 Lemon Squeezy Setup Guide

Complete guide to set up Lemon Squeezy payments for JUPITER.

## Why Lemon Squeezy?

- ✅ **Merchant of Record** - Handles all global tax compliance
- ✅ **No verification needed** for test mode
- ✅ **Better for indie devs** than Paddle
- ✅ **Transparent pricing** - ~5% + payment processing
- ✅ **Easy setup** - Up and running in 10 minutes

---

## Quick Setup (10 Minutes)

### Step 1: Create Account (2 min)

1. Go to https://lemonsqueezy.com
2. Sign up (use your email)
3. You're in! No verification needed for testing

### Step 2: Get Your API Key (1 min) ✅ DONE

Your API key is already in `.env.local`:
```bash
LEMONSQUEEZY_API_KEY=eyJ0eXAi... (already set!)
```

### Step 3: Get Your Store ID (1 min)

1. Go to https://app.lemonsqueezy.com/settings/stores
2. Click on your store
3. Copy the Store ID from the URL: `https://app.lemonsqueezy.com/stores/{STORE_ID}`
4. Add to `.env.local`:
```bash
LEMONSQUEEZY_STORE_ID=12345  # Replace with your Store ID
```

### Step 4: Create a Product (3 min)

1. Go to **Products** → **Add Product**
2. Fill in:
   - **Name**: "JUPITER Premium"
   - **Description**: "Access to premium features and advanced analytics"
   - **Price**: $29.00
   - **Billing**: Recurring (Monthly)
3. Click **Save**
4. On the product page, click **Variants**
5. Copy the **Variant ID** from the URL or variant details
6. Add to `.env.local`:
```bash
LEMONSQUEEZY_VARIANT_ID=123456  # Replace with your Variant ID
```

### Step 5: Set Up Webhooks (3 min)

1. Go to https://app.lemonsqueezy.com/settings/webhooks
2. Click **Add Webhook**
3. Set:
   - **Callback URL**: For now, use `https://example.com` (we'll update this later)
   - **Events**: Select all subscription events
4. Click **Save**
5. Copy the **Signing Secret**
6. Add to `.env.local`:
```bash
LEMONSQUEEZY_WEBHOOK_SECRET=abc123...  # Replace with your secret
```

---

## Testing Locally

### Test Without Webhooks

```bash
npm run dev
```

1. Go to http://localhost:3000/account
2. Click **Subscribe Now**
3. You'll be redirected to Lemon Squeezy checkout
4. Use test mode card: **4242 4242 4242 4242**
5. Complete checkout
6. You'll be redirected back to your app!

### Test With Webhooks (Optional)

For local webhook testing, use ngrok:

```bash
# Install ngrok
npm install -g ngrok

# Start your app
npm run dev

# In another terminal, start ngrok
ngrok http 3000

# Copy the ngrok URL (e.g., https://abc123.ngrok.io)
# Update webhook in Lemon Squeezy:
# https://abc123.ngrok.io/api/webhooks/lemonsqueezy
```

---

## Test Cards

Use these in test mode:

| Card Number | Expiry | CVC | Result |
|-------------|--------|-----|--------|
| 4242 4242 4242 4242 | Any future date | Any 3 digits | ✅ Success |
| 4000 0000 0000 0002 | Any future date | Any 3 digits | ❌ Decline |

---

## Production Deployment

### 1. Update Webhook URL

1. Deploy your app to production (Vercel, Railway, etc.)
2. Go to Lemon Squeezy → Settings → Webhooks
3. Update the callback URL to:
   ```
   https://yourdomain.com/api/webhooks/lemonsqueezy
   ```

### 2. Verify Everything Works

- [ ] Test signup flow
- [ ] Test payment with real card (refund immediately!)
- [ ] Verify webhook is received (check server logs)
- [ ] Test subscription management

---

## Database Schema (Recommended)

Store subscription data in your database:

```prisma
model Subscription {
  id                     String    @id @default(cuid())
  clerkUserId            String    @unique
  lemonSqueezySubscriptionId String @unique
  lemonSqueezyCustomerId String
  status                 String    // active, cancelled, expired, paused
  variantId              String
  currentPeriodEnd       DateTime?
  cancelAtPeriodEnd      Boolean   @default(false)
  createdAt              DateTime  @default(now())
  updatedAt              DateTime  @updatedAt

  @@index([clerkUserId])
  @@index([lemonSqueezySubscriptionId])
}
```

Then update the webhook handler and subscription API routes to use your database.

---

## Common Issues

### "Failed to create checkout"

**Problem**: Missing environment variables

**Solution**: Make sure these are set in `.env.local`:
- `LEMONSQUEEZY_API_KEY` ✅
- `LEMONSQUEEZY_STORE_ID` ⚠️ (you need to add this)
- `LEMONSQUEEZY_VARIANT_ID` ⚠️ (you need to add this)

### "Invalid signature" error

**Problem**: Webhook secret doesn't match

**Solution**: Copy the exact secret from Lemon Squeezy webhook settings

### Checkout redirects but no webhook received

**Problem**: Webhook URL is incorrect or not publicly accessible

**Solution**:
- For local testing, use ngrok
- For production, use your deployed URL

---

## Customer Portal

Lemon Squeezy doesn't have a built-in customer portal like Stripe. Instead:

1. Customers receive an email with a link to manage their subscription
2. The link goes to: `https://app.lemonsqueezy.com`
3. They can update payment method, cancel, etc.

Or, you can build your own using the Lemon Squeezy API.

---

## Pricing

### Test Mode
- ✅ **FREE** - No limits, test as much as you want

### Production
- **Transaction Fee**: ~5% + payment processing
- **No monthly fees**
- **They handle**: Tax, VAT, invoicing, customer support

Example:
- Customer pays $29/month
- Lemon Squeezy takes ~$1.45
- You receive ~$27.55

---

## Next Steps

1. ✅ Add Store ID to `.env.local`
2. ✅ Add Variant ID to `.env.local`
3. ✅ Test checkout locally
4. Set up database to store subscriptions
5. Deploy to production
6. Update webhook URL
7. Test with real payment

---

## Resources

- [Lemon Squeezy Dashboard](https://app.lemonsqueezy.com)
- [Lemon Squeezy Docs](https://docs.lemonsqueezy.com)
- [API Reference](https://docs.lemonsqueezy.com/api)
- [Webhook Events](https://docs.lemonsqueezy.com/api/webhooks)

---

## Support

Need help?
- Lemon Squeezy Support: https://lemonsqueezy.com/contact
- Discord: https://discord.gg/lemonsqueezy

You're all set! 🚀
