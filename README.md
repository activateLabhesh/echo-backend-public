# Echo Backend

A Node.js backend API built with Express, TypeScript, and Supabase.

## Local Development

1. Install dependencies:
```bash
npm install
```

2. Copy environment variables:
```bash
cp .env.example .env
```

3. Fill in your environment variables in `.env`

4. Start the development server:
```bash
npm run dev
```

The server will run at `http://localhost:5000`

## Docker Testing

### Prerequisites
- Docker installed and running
- docker-compose installed

### Quick Docker Test

1. **Test with Docker Compose** (includes Redis):
```bash
npm run docker:test
```

2. **Or manually with Docker Compose**:
```bash
npm run docker:compose
```

3. **Test with standalone Docker container**:
```bash
npm run docker:build
npm run docker:run
```

### Docker Commands

- `npm run docker:build` - Build Docker image
- `npm run docker:run` - Run Docker container
- `npm run docker:test` - Run comprehensive Docker test
- `npm run docker:compose` - Start with docker-compose (includes Redis)
- `npm run docker:compose:down` - Stop docker-compose services

### Docker Environment Variables

Make sure your `.env` file contains all necessary variables:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_S3_ACCESS_KEY`
- `SUPABASE_S3_SECRET_KEY`
- `SUPABASE_S3_ENDPOINT`
- `JWT_SECRET`
- `REFRESH_SECRET`
- `FRONTEND_URL` (optional, defaults to http://localhost:3000)

## Vercel Deployment

### Prerequisites
- Vercel CLI installed: `npm i -g vercel`
- Vercel account

### Quick Deployment

1. **Deploy with automated script**:
```bash
npm run deploy:vercel
```

2. **Or manually**:
```bash
vercel login
vercel --prod
```

### Manual Deployment Steps

1. **Install Vercel CLI** (if not already installed):
```bash
npm i -g vercel
```

2. **Login to Vercel**:
```bash
vercel login
```

3. **Deploy to Vercel**:
```bash
vercel
```

4. **Set Environment Variables**:
After deployment, you'll need to set your environment variables in the Vercel dashboard:
- Go to your project in the Vercel dashboard
- Navigate to Settings > Environment Variables
- Add all the variables from your `.env` file:
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `SUPABASE_S3_ACCESS_KEY`
  - `SUPABASE_S3_SECRET_KEY`
  - `SUPABASE_S3_ENDPOINT`
  - `JWT_SECRET`
  - `REFRESH_SECRET`
  - `FRONTEND_URL` (your frontend URL)

5. **Redeploy with environment variables**:
```bash
vercel --prod
```

### API Endpoints

Your API will be available at:
- Production: `https://your-project-name.vercel.app`
- Preview: `https://your-project-name-git-branch.vercel.app`

### Environment Variables for Production

Make sure to set these in your Vercel dashboard:
- `NODE_ENV=production`
- `FRONTEND_URL` (your frontend domain)

## API Routes

- `GET /` - Health check
- `POST /api/auth/*` - Authentication routes
- `POST /api/message/*` - Message routes  
- `POST /api/profile/*` - Profile routes

## Build Commands

- `npm run build` - Build TypeScript to JavaScript
- `npm start` - Start production server
- `npm run dev` - Start development server

## Docker Files

- `Dockerfile` - Development Docker configuration
- `Dockerfile.prod` - Production Docker configuration with multi-stage build
- `docker-compose.yml` - Local development with Redis
- `.dockerignore` - Files excluded from Docker builds

## Troubleshooting

### Docker Issues
- Make sure Docker is running
- Check if ports 5000 and 6379 are available
- Verify your `.env` file exists and has all required variables

### Vercel Issues
- Ensure you're logged in to Vercel CLI
- Check that all environment variables are set in Vercel dashboard
- Verify the build process works locally before deploying

### Build Issues
- Run `npm run build` to check for TypeScript errors
- Ensure all dependencies are installed with `npm install`