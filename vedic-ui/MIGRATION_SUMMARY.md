# Migration Summary: NextAuth + Stripe → Clerk + Paddle

## What Changed

### Authentication: NextAuth → Clerk

**Removed:**
- `next-auth` package
- `@auth/core` package
- `src/lib/auth.ts` (NextAuth config)
- `src/components/SessionProvider.tsx`

**Added:**
- `@clerk/nextjs` package
- `@clerk/themes` package
- `src/middleware.ts` (Clerk middleware for route protection)
- Updated `src/app/layout.tsx` with ClerkProvider
- Updated `src/app/auth/signin/page.tsx` to use Clerk SignIn component
- Created `src/app/auth/signup/page.tsx` with Clerk SignUp component

**Benefits:**
- Better UX with pre-built, customizable UI components
- Built-in user management dashboard
- Multi-factor authentication out of the box
- More social login options
- Better session management
- Easier to set up and maintain

### Payments: Stripe → Paddle

**Removed:**
- `stripe` package
- `@stripe/stripe-js` package
- Stripe API integration code

**Added:**
- `@paddle/paddle-js` package
- `src/lib/paddle.ts` (Paddle integration utilities)
- `src/app/api/webhooks/paddle/route.ts` (Paddle webhook handler)
- Updated `src/app/api/subscription/route.ts` to use Clerk auth

**Benefits:**
- Paddle acts as Merchant of Record (handles global tax compliance)
- No need to worry about VAT, sales tax, etc.
- Built-in invoicing
- Handles payment method updates
- Better for international sales
- Less operational overhead

## File Changes

### New Files Created
```
src/middleware.ts                          # Clerk route protection
src/app/auth/signup/page.tsx               # Sign up page
src/lib/paddle.ts                          # Paddle utilities
src/app/api/webhooks/paddle/route.ts       # Paddle webhooks
CLERK_PADDLE_SETUP.md                      # Detailed setup guide
QUICK_START.md                             # Quick start guide
MIGRATION_SUMMARY.md                       # This file
```

### Files Modified
```
src/app/layout.tsx                         # ClerkProvider instead of SessionProvider
src/app/auth/signin/page.tsx               # Clerk SignIn component
src/app/account/page.tsx                   # Clerk hooks + Paddle integration
src/app/api/subscription/route.ts          # Clerk auth
.env.local                                 # New env vars
.env.example                               # Updated template
package.json                               # Updated dependencies
```

### Files You Can Delete (Optional)
```
src/lib/auth.ts                            # Old NextAuth config
src/lib/stripe.ts                          # Old Stripe integration (if exists)
src/components/SessionProvider.tsx         # Old session provider
src/app/api/checkout/route.ts              # Old Stripe checkout (if exists)
src/app/api/portal/route.ts                # Old Stripe portal (if exists)
AUTH_SETUP.md                              # Old auth docs (if exists)
```

## Environment Variables

### Old (Remove these)
```bash
NEXTAUTH_SECRET=...
NEXTAUTH_URL=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
STRIPE_SECRET_KEY=...
STRIPE_WEBHOOK_SECRET=...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=...
STRIPE_PRICE_ID=...
```

### New (Add these)
```bash
# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=...
CLERK_SECRET_KEY=...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/auth/signin
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/auth/signup
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/

# Paddle
NEXT_PUBLIC_PADDLE_ENVIRONMENT=sandbox
NEXT_PUBLIC_PADDLE_CLIENT_TOKEN=...
NEXT_PUBLIC_PADDLE_PRICE_ID=...
PADDLE_WEBHOOK_SECRET=...
PADDLE_API_KEY=...
```

## Database Changes Needed

You'll need to update your database schema to work with Clerk and Paddle:

### Before (NextAuth + Stripe)
```
User {
  id
  email
  name
  image
  stripeCustomerId
}

Subscription {
  stripeSubscriptionId
  status
  ...
}
```

### After (Clerk + Paddle)
```
Subscription {
  id
  clerkUserId           # Link to Clerk user
  paddleSubscriptionId  # Paddle subscription ID
  paddleCustomerId      # Paddle customer ID
  status
  priceId
  currentPeriodEnd
  cancelAtPeriodEnd
  createdAt
  updatedAt
}

Payment {
  id
  subscriptionId
  paddleTransactionId
  amount
  currency
  status
  createdAt
}
```

**Note:** Clerk manages user data, so you don't need a User table. Just use `clerkUserId` to link data.

## Migration Steps for Existing Users

If you have existing users, you'll need to migrate them:

1. **Export users from NextAuth database**
2. **Import users to Clerk** using [Clerk's User Import API](https://clerk.com/docs/users/import-users)
3. **Map Stripe customers to Clerk users** in your database
4. **Keep Stripe active** until all subscriptions are migrated
5. **Gradually migrate** subscriptions to Paddle
6. **Once complete**, deactivate Stripe

## Testing Checklist

- [ ] Sign up with new account
- [ ] Sign in with existing social account
- [ ] Access protected routes
- [ ] Subscribe to premium (Sandbox)
- [ ] Verify webhook received
- [ ] Check subscription status on account page
- [ ] Test sign out
- [ ] Test payment failure handling

## Cost Comparison

### NextAuth + Stripe
- NextAuth: Free (self-hosted)
- Stripe: 2.9% + $0.30 per transaction
- You handle: Tax compliance, invoicing, customer support

### Clerk + Paddle
- Clerk Free Tier: Up to 10,000 MAU
- Clerk Pro: $25/month + $0.02/MAU above 10,000
- Paddle: ~5% + payment processing
- Paddle handles: Tax, invoicing, customer support

**Bottom Line:**
- Clerk + Paddle costs more per transaction
- BUT saves significant development and operational time
- Better for international sales
- Worth it for early-stage products

## Rollback Plan

If you need to rollback:

1. Reinstall old packages:
```bash
npm install next-auth @auth/core stripe @stripe/stripe-js
```

2. Restore old files from git:
```bash
git checkout main -- src/lib/auth.ts src/components/SessionProvider.tsx
```

3. Revert environment variables

4. Restart dev server

## Next Steps

1. Follow [QUICK_START.md](./QUICK_START.md) to set up Clerk and Paddle
2. Set up database schema (see [CLERK_PADDLE_SETUP.md](./CLERK_PADDLE_SETUP.md))
3. Test in Sandbox mode
4. Deploy to production
5. Monitor webhooks and subscriptions

## Questions?

Check these resources:
- [Clerk Docs](https://clerk.com/docs)
- [Paddle Docs](https://developer.paddle.com/)
- [Full Setup Guide](./CLERK_PADDLE_SETUP.md)

Good luck! 🚀
