/** @type {import('next').NextConfig} */
const nextConfig = {
  // El cliente de Prisma no debe empaquetarse en el bundle del servidor.
  serverExternalPackages: ["@prisma/client", "prisma", "web-push"],
  // Hostinger limita los procesos/hilos del plan (120, compartidos con la app
  // en marcha y otros sitios): compilar con un solo trabajador evita que el
  // build falle con "uv_thread_create" (SIGABRT).
  experimental: {
    cpus: 1,
    workerThreads: false,
  },
};

export default nextConfig;
