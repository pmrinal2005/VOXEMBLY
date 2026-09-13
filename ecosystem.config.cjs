// PM2 process definition — VOXEMBLY runs as a Next.js 15 server (Node runtime).
// Route Handlers need the Node runtime (FormData proxying to Sync STT, keep-alive connection pool),
// so this is `next start`, never a static export.
module.exports = {
  apps: [
    {
      name: "voxembly",
      script: "npm",
      args: "run start",
      cwd: "/home/user/webapp",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
        HOSTNAME: "0.0.0.0",
      },
      watch: false,
      instances: 1,
      exec_mode: "fork",
      max_restarts: 10,
      autorestart: true,
    },
  ],
};
