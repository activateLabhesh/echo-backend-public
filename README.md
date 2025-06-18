# Echo Backend Setup

---

## 📋 Prerequisites

Before you begin, ensure you have the following installed:

* **Docker Desktop** (or Docker Engine and Docker Compose for Linux): Essential for building and running containers.
    * [Install Docker Desktop](https://www.docker.com/products/docker-desktop/)
* **Git**: For cloning the repository.
    * [Install Git](https://git-scm.com/downloads)
* **Vercel CLI** (for deployment): Install globally for deployment.
    * ```bash
      npm install -g vercel
      ```

---

## 🚀 Deployment to Vercel

### Prerequisites for Deployment

1. **Vercel Account**: Sign up at [vercel.com](https://vercel.com)
2. **Environment Variables**: Set up your environment variables in Vercel dashboard or via CLI

### Deployment Steps

1. **Login to Vercel** (if not already logged in):
   ```bash
   vercel login
   ```

2. **Set Environment Variables**:
   You can set environment variables either through the Vercel dashboard or using the CLI:
   ```bash
   vercel env add SUPABASE_URL
   vercel env add SUPABASE_ANON_KEY
   vercel env add SUPABASE_SERVICE_ROLE_KEY
   vercel env add SUPABASE_S3_ACCESS_KEY
   vercel env add SUPABASE_S3_SECRET_KEY
   vercel env add SUPABASE_S3_ENDPOINT
   vercel env add FRONTEND_URL
   ```

3. **Deploy to Production**:
   ```bash
   npm run deploy
   ```
   Or manually:
   ```bash
   vercel --prod
   ```

4. **For Development/Preview Deployments**:
   ```bash
   vercel
   ```

### Environment Variables Required

Make sure to set these environment variables in your Vercel project:

- `SUPABASE_URL`: Your Supabase project URL
- `SUPABASE_ANON_KEY`: Your Supabase anonymous key
- `SUPABASE_SERVICE_ROLE_KEY`: Your Supabase service role key
- `SUPABASE_S3_ACCESS_KEY`: Your Supabase S3 access key
- `SUPABASE_S3_SECRET_KEY`: Your Supabase S3 secret key
- `SUPABASE_S3_ENDPOINT`: Your Supabase S3 endpoint
- `FRONTEND_URL`: Your frontend application URL (for CORS)

### API Endpoints

After deployment, your API will be available at:
- Base URL: `https://your-project-name.vercel.app`
- Health Check: `GET /`
- Auth Routes: `POST /api/auth/register`, `POST /api/auth/login`, etc.
- Message Routes: `GET /api/message`, `POST /api/message`, etc.

---

## 🛠️ Setup Instructions

Follow these steps to get the Echo Backend running with Docker:

1.  **Clone the Repository**

    ```bash
    git clone https://github.com/IEEECS-VIT/echo-backend
    cd echo-backend
    ```

2.  **Run the Application with Docker Compose (Recommended for Development)**

    This is the most convenient way to get started. Docker Compose will build the Docker image (if it doesn't exist or if changes are detected in the `Dockerfile` or project dependencies) and start the container.

    ```bash
    docker-compose up --build
    ```
    * The `--build` flag ensures that the Docker image is rebuilt if necessary. You can omit it on subsequent runs if you haven't changed your `Dockerfile` or `package.json`.
    * The application will run in the foreground, displaying logs directly in your terminal. To run in detached mode (background), add the `-d` flag: `docker-compose up -d --build`.

### Alternative: Build and Run Manually (Docker CLI)

If you prefer to manage the image and container separately using the Docker CLI:

1.  **Build the Docker Image**

    ```bash
    docker build -t echo-backend .
    ```
    This command reads the `Dockerfile` in the current directory (`.`) and builds an image tagged `echo-backend`. This step includes installing Node.js dependencies and building TypeScript code *inside the Docker image*.

2.  **Run the Docker Container**

    ```bash
    docker run -d -p 5000:5000 echo-backend
    ```
    * The `-d` flag runs the container in "detached" mode (in the background).
    * The `-p 5000:5000` flag maps port `5000` from the container to port `5000` on your host machine, making the application accessible from your browser or API client.

---

## ✅ Verifying the Setup

* Once the container is running, the Echo Backend application should be accessible via HTTP requests on **port 5000**.
* You can check running Docker containers with `docker ps`.

## 🛑 Stopping the Application

* **If using `docker-compose up` (without `-d`):** Press `Ctrl+C` in the terminal where Docker Compose is running.
* **If using `docker-compose up -d`:**
    ```bash
    docker-compose down
    ```
* **If using `docker run -d`:**
    1.  Find the container ID:
        ```bash
        docker ps
        ```
    2.  Stop the container:
        ```bash
        docker stop [container_id_or_name]
        ```

---

## 📝 Notes

* **No local Node.js installation is required for this setup.** All Node.js dependencies and the TypeScript build process are handled within the Docker container.
* The application listens on **port 5000** inside the container. Ensure this port is correctly mapped to a free port on your host machine.
* For advanced configurations or debugging, you may inspect the `Dockerfile` and `docker-compose.yml` files in the repository.