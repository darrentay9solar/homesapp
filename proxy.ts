import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

/**
 * Everything is private except the routes listed here.
 *
 * Deny-by-default matters for this app: the four roles see materially
 * different data, and a page that forgets its own auth check should fail
 * closed rather than leak a homeowner's project to the internet.
 */
const isPublic = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  // The health checks must stay reachable: an uptime monitor cannot sign in,
  // and they deliberately expose no project data.
  "/api/health",
  // The Python runtime's equivalent. Only this one Python route is public —
  // anything that does real work stays behind the proxy, and scheduled jobs
  // will authenticate with a shared secret rather than a session.
  "/api/health.py",
]);

export default clerkMiddleware(async (auth, request) => {
  if (isPublic(request)) return;

  // `auth.protect()` answers 404 for an unauthenticated visitor rather than
  // revealing that the route exists. That is a reasonable default for an API,
  // but for a page it looks like the site is broken — the root returned 404 in
  // production while /sign-in returned 200. Redirecting explicitly is both
  // clearer to the user and consistent between dev and production.
  const { userId, redirectToSignIn } = await auth();
  if (!userId) {
    return redirectToSignIn({ returnBackUrl: request.url });
  }
});

export const config = {
  matcher: [
    // Everything except Next internals and static files, unless they appear
    // in a search param.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes.
    "/(api|trpc)(.*)",
    // Clerk's auto-proxy path; without it the handshake cannot resolve.
    "/__clerk/:path*",
  ],
};
