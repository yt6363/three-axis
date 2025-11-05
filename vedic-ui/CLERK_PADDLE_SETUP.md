# Clerk + Paddle Integration Setup Guide

This guide will walk you through setting up Clerk authentication and Paddle payments for your JUPITER application.

## Table of Contents
1. [Clerk Authentication Setup](#clerk-authentication-setup)
2. [Paddle Payments Setup](#paddle-payments-setup)
3. [Database Setup](#database-setup)
4. [Testing](#testing)
5. [Production Deployment](#production-deployment)

---

## Clerk Authentication Setup

### Step 1: Create a Clerk Account

1. Go to [https://clerk.com](https://clerk.com) and sign up
2. Create a new application
3. Choose your application name (e.g., "JUPITER")

### Step 2: Configure OAuth Providers

1. In the Clerk Dashboard, go to **User & Authentication** → **Social Connections**
2. Enable **Google** (recommended)
3. You can also enable:
   - GitHub
   - Microsoft
   - Apple
   - And many more...

### Step 3: Get Your API Keys

1. Go to **API Keys** in the Clerk Dashboard
2. Copy your keys and add them to `.env.local`:

```bash
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
```

### Step 4: Configure Appearance (Optional)

The app is already configured with a dark theme matching your design. You can customize further in:
- `src/app/layout.tsx` - Global theme settings
- `src/app/auth/signin/page.tsx` - Sign in page customization
- `src/app/auth/signup/page.tsx` - Sign up page customization

### Step 5: Test Authentication

```bash
npm run dev
```

Visit `http://localhost:3000/auth/signin` and try signing in!

---

## Paddle Payments Setup

### Step 1: Create a Paddle Account

1. Go to [https://paddle.com](https://paddle.com) and sign up
2. Complete business verification (required for live mode)
3. For testing, use **Sandbox mode**

### Step 2: Set Up Sandbox Environment

1. In Paddle Dashboard, switch to **Sandbox** mode (top right)
2. Go to **Developer Tools** → **Authentication**
3. Create a new **Client-side token**
4. Copy the token to `.env.local`:

```bash
NEXT_PUBLIC_PADDLE_CLIENT_TOKEN=live_...
NEXT_PUBLIC_PADDLE_ENVIRONMENT=sandbox
```

### Step 3: Create a Subscription Product

1. Go to **Catalog** → **Products**
2. Click **Add Product**
3. Set up your product:
   - Name: "JUPITER Premium"
   - Description: "Access to premium features"
   - Type: **Subscription**

4. Add a pricing option:
   - Billing interval: **Monthly**
   - Price: $29.00 (or your preferred price)
   - Currency: USD

5. Click **Save Product**

### Step 4: Get Your Price ID

1. After creating the product, click on it
2. Copy the **Price ID** (looks like `pri_...`)
3. Add it to `.env.local`:

```bash
NEXT_PUBLIC_PADDLE_PRICE_ID=pri_...
```

### Step 5: Set Up Webhooks

1. Go to **Developer Tools** → **Notifications**
2. Click **Add Notification Destination**
3. Set the URL to: `https://yourdomain.com/api/webhooks/paddle`
   - For local testing, use ngrok: `https://your-ngrok-url.ngrok.io/api/webhooks/paddle`
4. Subscribe to these events:
   - `subscription.created`
   - `subscription.updated`
   - `subscription.canceled`
   - `transaction.completed`
   - `transaction.payment_failed`
5. Copy the **Webhook Secret** and add to `.env.local`:

```bash
PADDLE_WEBHOOK_SECRET=pdl_ntfset_...
```

### Step 6: Test Payments (Sandbox)

Use these test cards in Sandbox mode:

- **Successful Payment**: `4242 4242 4242 4242`
- **Payment Fails**: `4000 0000 0000 0002`
- **Requires Authentication**: `4000 0025 0000 3155`

Any future expiry date and any CVC will work.

---

## Database Setup

You need to store subscription data in a database. Here's a recommended schema:

### Option 1: Using Prisma (Recommended)

1. Install Prisma:
```bash
npm install prisma @prisma/client
npx prisma init
```

2. Update `prisma/schema.prisma`:

```prisma
model Subscription {
  id                 String    @id @default(cuid())
  clerkUserId        String    @unique
  paddleSubscriptionId String   @unique
  paddleCustomerId   String
  status             String    // active, canceled, past_due, etc.
  priceId            String
  currentPeriodEnd   DateTime?
  cancelAtPeriodEnd  Boolean   @default(false)
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt

  @@index([clerkUserId])
  @@index([paddleSubscriptionId])
}

model Payment {
  id                 String   @id @default(cuid())
  subscriptionId     String
  paddleTransactionId String  @unique
  amount             String
  currency           String
  status             String
  createdAt          DateTime @default(now())

  @@index([subscriptionId])
}
```

3. Run migrations:
```bash
npx prisma migrate dev --name init
npx prisma generate
```

4. Update API routes to use Prisma:

In `src/app/api/subscription/route.ts`:
```typescript
import { prisma } from '@/lib/prisma';

const subscription = await prisma.subscription.findUnique({
  where: { clerkUserId: userId }
});
```

In `src/app/api/webhooks/paddle/route.ts`:
```typescript
import { prisma } from '@/lib/prisma';

async function handleSubscriptionCreated(data: any) {
  await prisma.subscription.create({
    data: {
      clerkUserId: data.custom_data.user_id,
      paddleSubscriptionId: data.id,
      paddleCustomerId: data.customer_id,
      status: data.status,
      priceId: data.items[0].price_id,
      currentPeriodEnd: new Date(data.current_billing_period.ends_at),
    }
  });
}
```

### Option 2: Using Your Existing Database

Adapt the schema to your database system (PostgreSQL, MySQL, MongoDB, etc.)

---

## Testing

### Test Authentication Flow

1. Start dev server: `npm run dev`
2. Go to `/auth/signin`
3. Sign in with Google (or other provider)
4. Verify redirect to home page
5. Go to `/account`
6. Verify profile info displays correctly

### Test Payment Flow (Sandbox)

1. Make sure Paddle is in Sandbox mode
2. Go to `/account`
3. Click "Subscribe Now"
4. Use test card: `4242 4242 4242 4242`
5. Complete checkout
6. Verify webhook is received (check server logs)
7. Refresh `/account` page
8. Verify subscription status shows as "Active"

### Test Webhooks Locally

Use ngrok to expose your local server:

```bash
# Install ngrok
npm install -g ngrok

# Start your dev server
npm run dev

# In another terminal, start ngrok
ngrok http 3000

# Copy the ngrok URL and add it to Paddle webhook settings
# Example: https://abc123.ngrok.io/api/webhooks/paddle
```

---

## Production Deployment

### Environment Variables

Set these in your production environment (Vercel, Railway, etc.):

```bash
# Clerk Production Keys
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_...
CLERK_SECRET_KEY=sk_live_...

# Paddle Production Settings
NEXT_PUBLIC_PADDLE_ENVIRONMENT=production
NEXT_PUBLIC_PADDLE_CLIENT_TOKEN=live_...
NEXT_PUBLIC_PADDLE_PRICE_ID=pri_...
PADDLE_WEBHOOK_SECRET=pdl_ntfset_...
PADDLE_API_KEY=...
```

### Checklist

- [ ] Switch Clerk to production mode
- [ ] Update Clerk redirect URLs to production domain
- [ ] Switch Paddle to production mode
- [ ] Update Paddle webhook URL to production domain
- [ ] Set up production database
- [ ] Test authentication flow
- [ ] Test payment flow with real card (refund immediately)
- [ ] Monitor webhooks in Paddle dashboard
- [ ] Set up error monitoring (Sentry, LogRocket, etc.)

---

## Troubleshooting

### Clerk Issues

**Problem**: Redirect loop after signin
- **Solution**: Check that `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL` is set correctly

**Problem**: "Invalid publishable key"
- **Solution**: Make sure you're using the correct key for your environment (test vs. production)

### Paddle Issues

**Problem**: Checkout doesn't open
- **Solution**: Check browser console for errors. Verify `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN` and `NEXT_PUBLIC_PADDLE_PRICE_ID` are set

**Problem**: Webhooks not received
- **Solution**:
  - Verify webhook URL is correct and publicly accessible
  - Check webhook logs in Paddle Dashboard
  - For local testing, use ngrok
  - Verify signature verification is working

**Problem**: "Invalid signature" error
- **Solution**: Make sure `PADDLE_WEBHOOK_SECRET` matches the one in Paddle Dashboard

### Database Issues

**Problem**: Subscription not saving
- **Solution**:
  - Check database connection
  - Verify schema matches webhook payload
  - Check server logs for errors

---

## Additional Resources

- [Clerk Documentation](https://clerk.com/docs)
- [Clerk Next.js Guide](https://clerk.com/docs/quickstarts/nextjs)
- [Paddle Documentation](https://developer.paddle.com/)
- [Paddle Webhooks Guide](https://developer.paddle.com/webhooks/overview)
- [Paddle Sandbox Testing](https://developer.paddle.com/concepts/sandbox)

---

## Support

If you run into issues:

1. Check the browser console for errors
2. Check server logs
3. Verify all environment variables are set
4. Test in Sandbox mode first
5. Check Clerk and Paddle dashboards for logs

## Next Steps

After setup is complete:

1. Customize subscription tiers and pricing
2. Add more features behind the paywall
3. Set up email notifications for subscription events
4. Add analytics tracking for conversions
5. Implement referral program (optional)
6. Add annual billing option (optional)
