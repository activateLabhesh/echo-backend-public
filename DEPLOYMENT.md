# Vercel Deployment Guide

This guide will help you deploy your Echo Backend to Vercel.

## Prerequisites

1. **Vercel Account**: Sign up at [vercel.com](https://vercel.com)
2. **Vercel CLI**: Install globally
   ```bash
   npm install -g vercel
   ```

## Quick Deployment

### 1. Login to Vercel
```bash
vercel login
```

### 2. Set Environment Variables
You need to set these environment variables in your Vercel project. You can do this either through the Vercel dashboard or using the CLI:

**Option A: Using Vercel Dashboard**
1. Go to your project in the Vercel dashboard
2. Navigate to Settings → Environment Variables
3. Add each variable with its corresponding value

**Option B: Using Vercel CLI**
```bash
vercel env add SUPABASE_URL
vercel env add SUPABASE_ANON_KEY
vercel env add SUPABASE_SERVICE_ROLE_KEY
vercel env add SUPABASE_S3_ACCESS_KEY
vercel env add SUPABASE_S3_SECRET_KEY
vercel env add SUPABASE_S3_ENDPOINT
vercel env add FRONTEND_URL
```

### 3. Deploy
```bash
npm run deploy
```

## Environment Variables

Make sure you have these environment variables set in your Vercel project:

| Variable | Description | Required |
|----------|-------------|----------|
| `SUPABASE_URL` | Your Supabase project URL | Yes |
| `SUPABASE_ANON_KEY` | Your Supabase anonymous key | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Your Supabase service role key | Yes |
| `SUPABASE_S3_ACCESS_KEY` | Your Supabase S3 access key | Yes |
| `SUPABASE_S3_SECRET_KEY` | Your Supabase S3 secret key | Yes |
| `SUPABASE_S3_ENDPOINT` | Your Supabase S3 endpoint | Yes |
| `FRONTEND_URL` | Your frontend application URL (for CORS) | No (defaults to localhost:3000) |

## API Endpoints

After deployment, your API will be available at:
- **Base URL**: `https://your-project-name.vercel.app`
- **Health Check**: `GET /`
- **Auth Routes**: 
  - `POST /api/auth/register`
  - `POST /api/auth/login`
  - `GET /api/auth/refresh`
  - `GET /api/auth/logout`
  - `GET /api/auth/test`
- **Message Routes**: 
  - `POST /api/message/message`
- **Profile Routes**: 
  - `PUT /api/profile/update`
  - `PUT /api/profile/update-status`

## Development

For local development with Vercel:
```bash
npm run dev
```

This will start the Vercel development server locally.

## Troubleshooting

### Common Issues

1. **Environment Variables Not Set**: Make sure all required environment variables are set in your Vercel project.

2. **CORS Issues**: Update the `FRONTEND_URL` environment variable to match your frontend domain.

3. **Database Connection Issues**: Verify your Supabase credentials are correct.

4. **File Upload Issues**: Ensure your Supabase S3 configuration is properly set up.

### Checking Logs

You can check your function logs in the Vercel dashboard:
1. Go to your project in the Vercel dashboard
2. Navigate to Functions
3. Click on your function to view logs

### Local Testing

Test your serverless function locally:
```bash
vercel dev
```

This will start a local development server that mimics the Vercel environment.

## Support

If you encounter any issues:
1. Check the Vercel documentation: [vercel.com/docs](https://vercel.com/docs)
2. Check the function logs in your Vercel dashboard
3. Verify all environment variables are correctly set 