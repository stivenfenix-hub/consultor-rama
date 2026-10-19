/** @type {import('next').NextConfig} */
const nextConfig = {
  // El cliente de Prisma no debe empaquetarse en el bundle del servidor.
  serverExternalPackages: ["@prisma/client", "prisma"],
};

export default nextConfig;
