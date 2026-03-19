export { auth as proxy } from "@/auth";

export const config = {
  matcher: ["/projects/:path*", "/api/:path*"],
};
