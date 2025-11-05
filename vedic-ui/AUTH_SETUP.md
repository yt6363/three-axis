# Authentication & Payment Setup Guide

This guide will help you set up Google OAuth authentication and Stripe payment integration for the Vedic Trading Terminal.

## Prerequisites

- Node.js 18+ installed
- A Google Cloud account
- A Stripe account

## 1. Google OAuth Setup

### Step 1: Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Google+ API for your project

### Step 2: Create OAuth 2.0 Credentials

1. Navigate to **APIs & Services** > **Credentials**
2. Click **Create Credentials** > **OAuth client ID**
3. Select **Web application**
4. Add authorized redirect URIs:
   - `http://localhost:3000/api/auth/callback/google` (development)
   - `https://yourdomain.com/api/auth/callback/google` (production)
5. Save the **Client ID** and **Client Secret**

## 2. Stripe Setup

### Step 1: Create a Stripe Account

1. Sign up at [Stripe](https://dashboard.stripe.com/register)
2. Complete account verification

### Step 2: Get API Keys

1. Navigate to **Developers** > **API keys**
2. Copy your **Publishable key** and **Secret key**
3. For testing, use the test mode keys (starts with `pk_test_` and `sk_test_`)

### Step 3: Create a Product and Price

1. Navigate to **Products** > **Add product**
2. Enter product details:
   - Name: "Premium Subscription"
   - Description: "Access to premium Vedic trading features"
3. Add a pricing option:
   - Pricing model: **Recurring**
   - Price: $29
   - Billing period: **Monthly**
4. Save and copy the **Price ID** (starts with `price_`)

### Step 4: Set Up Webhooks

1. Navigate to **Developers** > **Webhooks**
2. Click **Add endpoint**
3. Enter endpoint URL:
   - Development: Use [Stripe CLI](https://stripe.com/docs/stripe-cli) for local testing
   - Production: `https://yourdomain.com/api/webhooks/stripe`
4. Select events to listen to:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
5. Copy the **Webhook signing secret** (starts with `whsec_`)

## 3. Environment Variables

1. Copy the example environment file:
   ```bash
   cp .env.example .env.local
   ```

2. Fill in the values in `.env.local`:

```env
# NextAuth Configuration
NEXTAUTH_SECRET=<generate with: openssl rand -base64 32>
NEXTAUTH_URL=http://localhost:3000

# Google OAuth
GOOGLE_CLIENT_ID=<your-google-client-id>
GOOGLE_CLIENT_SECRET=<your-google-client-secret>

# Stripe Configuration
STRIPE_SECRET_KEY=<your-stripe-secret-key>
STRIPE_WEBHOOK_SECRET=<your-webhook-secret>
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=<your-publishable-key>
STRIPE_PRICE_ID=<your-price-id>

# App URL
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

## 4. Testing Locally

### Test Stripe Webhooks Locally

1. Install Stripe CLI:
   ```bash
   brew install stripe/stripe-cli/stripe
   ```

2. Login to Stripe:
   ```bash
   stripe login
   ```

3. Forward webhooks to your local server:
   ```bash
   stripe listen --forward-to localhost:3000/api/webhooks/stripe
   ```

4. Copy the webhook signing secret from the CLI output and update `.env.local`

### Test the Application

1. Start the development server:
   ```bash
   npm run dev
   ```

2. Navigate to `http://localhost:3000`

3. Click **Sign In** and authenticate with Google

4. Navigate to the **Account** page

5. Test subscription checkout using [Stripe test cards](https://stripe.com/docs/testing):
   - Successful payment: `4242 4242 4242 4242`
   - Requires authentication: `4000 0025 0000 3155`
   - Declined payment: `4000 0000 0000 9995`

## 5. Production Deployment

1. Update environment variables for production:
   - Use production Google OAuth credentials
   - Use production Stripe API keys
   - Update `NEXTAUTH_URL` and `NEXT_PUBLIC_APP_URL` to your domain

2. Set up real webhook endpoint in Stripe Dashboard

3. Enable Stripe billing portal:
   - Navigate to **Settings** > **Billing** > **Customer portal**
   - Configure the portal settings
   - Enable subscription management features

## Features Implemented

### Authentication
- ✅ Google OAuth sign-in
- ✅ Session management with NextAuth
- ✅ Protected account page
- ✅ Sign out functionality

### Account Management
- ✅ User profile display
- ✅ Subscription status tracking
- ✅ Upgrade to premium subscription
- ✅ Manage subscription via Stripe portal

### Stripe Integration
- ✅ Checkout session creation
- ✅ Subscription management
- ✅ Customer portal integration
- ✅ Webhook handling for subscription events
- ✅ Real-time subscription status updates

## File Structure

```
src/
├── app/
│   ├── account/
│   │   └── page.tsx              # Account management page
│   ├── api/
│   │   ├── auth/
│   │   │   └── [...nextauth]/
│   │   │       └── route.ts      # NextAuth API routes
│   │   ├── checkout/
│   │   │   └── route.ts          # Stripe checkout API
│   │   ├── portal/
│   │   │   └── route.ts          # Stripe portal API
│   │   ├── subscription/
│   │   │   └── route.ts          # Subscription status API
│   │   └── webhooks/
│   │       └── stripe/
│   │           └── route.ts      # Stripe webhook handler
│   ├── auth/
│   │   ├── signin/
│   │   │   └── page.tsx          # Sign-in page
│   │   └── error/
│   │       └── page.tsx          # Auth error page
│   └── layout.tsx                # Root layout with SessionProvider
├── components/
│   └── SessionProvider.tsx       # Client-side session provider
├── lib/
│   ├── auth.ts                   # NextAuth configuration
│   └── stripe.ts                 # Stripe utilities
└── types/
    └── next-auth.d.ts            # NextAuth type extensions
```

## Troubleshooting

### Google OAuth Issues
- Ensure redirect URIs match exactly in Google Cloud Console
- Verify the OAuth consent screen is configured
- Check that the Google+ API is enabled

### Stripe Issues
- Confirm you're using the correct API keys (test vs production)
- Verify webhook signing secret matches
- Check webhook events are being received in Stripe Dashboard
- Use Stripe CLI for local webhook testing

### NextAuth Issues
- Ensure `NEXTAUTH_SECRET` is set and is a strong random string
- Verify `NEXTAUTH_URL` matches your application URL
- Check browser console for CORS or cookie issues

## Support

For issues or questions:
- NextAuth Documentation: https://next-auth.js.org/
- Stripe Documentation: https://stripe.com/docs
- Google OAuth Documentation: https://developers.google.com/identity/protocols/oauth2
