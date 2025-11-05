# JUPITER Production Setup

## 🎯 Quick Deploy Command

Open your terminal and run:

```bash
cd "/Users/tatineniyashwanth/Library/Mobile Documents/com~apple~CloudDocs/VD/vedic-ui"
vercel
```

## 📋 Environment Variables for Vercel

After your first deployment, go to Vercel Dashboard → Settings → Environment Variables and add:

### 1. Backend API (READY)
```
NEXT_PUBLIC_API_BASE=https://jupiter-terminal-production.up.railway.app
```

### 2. NextAuth (READY)
```
NEXTAUTH_SECRET=mYo1eFvpKyRdCR+ZAdrpl1Ic2OE0eXYIAjPJFlsVWr0=
NEXTAUTH_URL=https://your-actual-vercel-url.vercel.app
```
⚠️ **Update `NEXTAUTH_URL` after you get your Vercel URL**

### 3. App URL (UPDATE AFTER DEPLOYMENT)
```
NEXT_PUBLIC_APP_URL=https://your-actual-vercel-url.vercel.app
```

### 4. Google OAuth (CONFIGURE LATER - Task 3)
```
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
```

### 5. Stripe (CONFIGURE LATER - Task 2)
```
STRIPE_SECRET_KEY=sk_test_your-stripe-secret-key
STRIPE_WEBHOOK_SECRET=whsec_your-webhook-secret
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_your-publishable-key
STRIPE_PRICE_ID=price_your-price-id
```

## 🚀 Deployment Steps

### Step 1: Deploy Frontend

```bash
cd "/Users/tatineniyashwanth/Library/Mobile Documents/com~apple~CloudDocs/VD/vedic-ui"
vercel
```

**Answer the prompts:**
- Set up and deploy? → **Y**
- Which scope? → Select your account
- Link to existing project? → **N**
- Project name? → **jupiter-vedic** (or your choice)
- Directory? → **./** (press Enter)
- Modify settings? → **N**

### Step 2: Add Environment Variables

1. Go to https://vercel.com/dashboard
2. Click your project
3. Go to **Settings** → **Environment Variables**
4. Add ALL the variables from section above
5. Make sure to select **Production**, **Preview**, and **Development** for each variable

### Step 3: Redeploy with Environment Variables

After adding environment variables:

```bash
vercel --prod
```

## 📝 What to Do After Deployment

### Immediately After First Deploy:

1. ✅ Copy your Vercel URL (e.g., `https://jupiter-vedic.vercel.app`)
2. ✅ Update these variables in Vercel Dashboard:
   - `NEXTAUTH_URL` = your Vercel URL
   - `NEXT_PUBLIC_APP_URL` = your Vercel URL
3. ✅ Redeploy: `vercel --prod`

### Task 2: Configure Stripe (After you have Vercel URL)

1. Go to https://dashboard.stripe.com
2. Create account / Login
3. Get API keys from https://dashboard.stripe.com/apikeys
4. Create a Product and Price (monthly subscription $29)
5. Set up webhook: `https://your-vercel-url.vercel.app/api/webhooks/stripe`
6. Add all Stripe env vars to Vercel
7. Redeploy

### Task 3: Configure Google OAuth (After you have Vercel URL)

1. Go to https://console.cloud.google.com/
2. Create a project (or select existing)
3. Enable Google+ API
4. Create OAuth 2.0 credentials
5. Add authorized redirect URIs:
   - `https://your-vercel-url.vercel.app/api/auth/callback/google`
6. Copy Client ID and Client Secret
7. Add to Vercel environment variables
8. Redeploy

## 🔗 Important URLs

- **Frontend (after deployment)**: https://your-vercel-url.vercel.app
- **Backend API**: https://jupiter-terminal-production.up.railway.app
- **API Docs**: https://jupiter-terminal-production.up.railway.app/docs
- **Vercel Dashboard**: https://vercel.com/dashboard
- **Railway Dashboard**: https://railway.app/project/ba162773-a772-46f5-94f7-cefad5917f5c
- **Stripe Dashboard**: https://dashboard.stripe.com
- **Google Cloud Console**: https://console.cloud.google.com/

## 🎨 Your Generated Secrets

```bash
# NEXTAUTH_SECRET (already generated for you)
NEXTAUTH_SECRET=mYo1eFvpKyRdCR+ZAdrpl1Ic2OE0eXYIAjPJFlsVWr0=
```

## ✅ Checklist

- [ ] Deploy frontend to Vercel (`vercel`)
- [ ] Get production URL
- [ ] Add environment variables in Vercel Dashboard
- [ ] Update NEXTAUTH_URL and NEXT_PUBLIC_APP_URL
- [ ] Redeploy with prod env vars (`vercel --prod`)
- [ ] Test frontend at production URL
- [ ] Configure Stripe account and webhooks
- [ ] Configure Google OAuth credentials
- [ ] Final test: Sign in, subscribe, fetch market data

## 🆘 Troubleshooting

### Build fails on Vercel
```bash
# Test build locally first
npm run build
```

### Environment variables not working
- Make sure they're added to **Production** environment in Vercel
- Redeploy after adding variables
- Check spelling and no extra spaces

### "Invalid CSRF token" error
- Make sure `NEXTAUTH_URL` matches your actual Vercel URL
- Must include https://

### Backend API not working
- Check Railway backend is running
- Test: https://jupiter-terminal-production.up.railway.app/docs
- Check CORS settings allow your Vercel domain

## 📞 Support

If you get stuck:
1. Check Vercel deployment logs
2. Check Railway backend logs: `railway logs`
3. Check browser console for errors
4. Verify all environment variables are set correctly
