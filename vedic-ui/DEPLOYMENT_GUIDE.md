# JUPITER Frontend Deployment Guide

## Current Status

✅ Backend deployed to Railway: https://jupiter-terminal-production.up.railway.app
✅ Vercel CLI installed and authenticated
⏳ Frontend ready for deployment

## Deploy to Vercel

### Option 1: Deploy via Vercel CLI (Recommended)

Run these commands in your terminal:

```bash
cd "/Users/tatineniyashwanth/Library/Mobile Documents/com~apple~CloudDocs/VD/vedic-ui"
vercel
```

**During the interactive setup:**
1. Set up and deploy? **Y**
2. Which scope? Select your personal account
3. Link to existing project? **N**
4. What's your project's name? **jupiter-vedic** (or any name you prefer)
5. In which directory is your code located? **./** (press Enter)
6. Want to modify settings? **N**

After deployment completes, you'll get a production URL like:
`https://jupiter-vedic.vercel.app`

### Option 2: Deploy via Vercel Dashboard

1. Go to https://vercel.com/new
2. Import your Git repository (or upload the project folder)
3. Configure project settings:
   - Framework Preset: **Next.js**
   - Build Command: `npm run build`
   - Output Directory: `.next`
4. Click **Deploy**

## Configure Environment Variables

After deployment, you MUST add environment variables in Vercel Dashboard:

1. Go to your project on Vercel Dashboard
2. Click **Settings** → **Environment Variables**
3. Add these variables:

### Required Variables:

```bash
# Backend API
NEXT_PUBLIC_API_BASE=https://jupiter-terminal-production.up.railway.app

# NextAuth
NEXTAUTH_SECRET=<generate with: openssl rand -base64 32>
NEXTAUTH_URL=https://your-vercel-url.vercel.app

# Google OAuth (configure later)
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# Stripe (configure later)
STRIPE_SECRET_KEY=sk_test_your-key
STRIPE_WEBHOOK_SECRET=whsec_your-webhook-secret
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_your-key
STRIPE_PRICE_ID=price_your-price-id

# App URL
NEXT_PUBLIC_APP_URL=https://your-vercel-url.vercel.app
```

### Generate NEXTAUTH_SECRET:

```bash
openssl rand -base64 32
```

Copy the output and use it as `NEXTAUTH_SECRET`

## After Deployment

1. **Update NEXTAUTH_URL** to your actual Vercel URL
2. **Update NEXT_PUBLIC_APP_URL** to your actual Vercel URL
3. **Redeploy** after adding environment variables:
   ```bash
   vercel --prod
   ```

## Next Steps After Frontend Deployment

1. ✅ Get your production URL
2. ⏳ Configure Google OAuth with production URLs
3. ⏳ Configure Stripe with production webhook URL
4. ⏳ Update Railway backend CORS to allow your Vercel domain

## Troubleshooting

### If deployment fails:

1. Check build logs in Vercel Dashboard
2. Ensure all dependencies are in `package.json`
3. Check for TypeScript errors: `npm run build` locally

### If app loads but doesn't work:

1. Check environment variables are set
2. Check browser console for errors
3. Verify backend API is accessible from production

## Useful Commands

```bash
# Deploy to production
vercel --prod

# Check deployment status
vercel ls

# View logs
vercel logs

# Open project in Vercel Dashboard
vercel open
```
