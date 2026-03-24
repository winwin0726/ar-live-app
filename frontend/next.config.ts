import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ['192.168.31.105', '10.0.0.140', 'loca.lt', 'localhost', 'trycloudflare.com', 'ngrok-free.dev', 'photoheliographic-unexigible-latanya.ngrok-free.dev'], 
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [
      {
        source: '/socket.io',
        // NestJS 웹소켓 서버는 무조건 끝에 슬래시(/)가 붙어야만 응답(200)을 하고, 없으면 404를 내뱉습니다.
        destination: 'http://127.0.0.1:3001/socket.io/',
      },
      {
        source: '/socket.io/:path*',
        destination: 'http://127.0.0.1:3001/socket.io/:path*',
      },
    ];
  },
};

export default nextConfig;
