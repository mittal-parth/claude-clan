import { authorizeUrl, installUrl, signState, verifyState } from "@sudo-city/cities";
import type { FastifyInstance } from "fastify";
import {
  SESSION_COOKIE_MAX_AGE_SECONDS,
  SESSION_COOKIE_NAME,
  sessionToken,
  type AuthContext,
  resolveSession,
} from "../auth-context.js";

export function registerAuthRoutes(app: FastifyInstance, auth: AuthContext): void {
  // Login: always the plain OAuth authorize endpoint, whether or not the
  // App is already installed for this account -- see authorizeUrl's doc.
  app.get("/auth/github/start", async (_request, reply) => {
    const state = signState(auth.stateSecret, new Date());
    await reply.redirect(authorizeUrl(auth.clientId, state));
  });

  // Granting/expanding repo access: the installations/new picker, used from
  // the repo picker's "grant access" link, not from the login button.
  app.get("/auth/github/install", async (_request, reply) => {
    const state = signState(auth.stateSecret, new Date());
    await reply.redirect(installUrl(auth.appSlug, state));
  });

  app.get<{ Querystring: { code?: string; state?: string } }>(
    "/auth/github/callback",
    async (request, reply) => {
      const { code: githubCode, state } = request.query;
      if (!githubCode) {
        await reply.code(400).send({ error: "Missing code" });
        return;
      }
      // `state` is best-effort here -- GitHub has historically dropped it
      // across the installations/new -> automatic-authorize redirect chain
      // (unlike the plain /login/oauth/authorize flow, where it's
      // reliable). This is a fresh-login endpoint, not account linking into
      // an existing session, so a missing/invalid state degrades to "treat
      // this as an unverified fresh login" rather than a hard failure.
      if (state && !verifyState(state, auth.stateSecret, new Date())) {
        await reply.code(400).send({ error: "Invalid or expired state" });
        return;
      }

      try {
        const tokens = await auth.githubAuth.exchangeCode(githubCode);
        const viewer = await auth.githubAuth.viewer(tokens.accessToken);
        const sessionId = await auth.db.createSession(
          { id: viewer.id, login: viewer.login, avatarUrl: viewer.avatarUrl },
          tokens,
        );
        // This callback lands on the API's own origin (it's GitHub's
        // redirect_uri, registered outside this app), not the web app's --
        // a cookie set here would be scoped to the wrong origin entirely.
        // Handing off a one-time code and finishing on `/api/auth/finish`
        // (reached through the web app's own domain, proxied to this same
        // API) is what lets the browser see the Set-Cookie response as
        // coming from the app's own origin.
        const finishCode = auth.loginCodes.create(sessionId);
        await reply.redirect(`${auth.webOrigin}/api/auth/finish?code=${finishCode}`);
      } catch (error) {
        app.log.error({ error }, "GitHub login callback failed");
        await reply.redirect(`${auth.webOrigin}/#session-error=1`);
      }
    },
  );

  app.get<{ Querystring: { code?: string } }>("/api/auth/finish", async (request, reply) => {
    const sessionId = request.query.code ? auth.loginCodes.consume(request.query.code) : undefined;
    if (!sessionId) {
      await reply.redirect(`${auth.webOrigin}/#session-error=1`);
      return;
    }
    reply.setCookie(SESSION_COOKIE_NAME, sessionId, {
      httpOnly: true,
      secure: auth.secureCookies,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
    });
    await reply.redirect(auth.webOrigin);
  });

  app.get("/api/auth/session", async (request) => {
    const token = sessionToken(request);
    if (!token) {
      return { authenticated: false as const, mode: "anonymous" as const };
    }
    const session = await resolveSession(token, auth, new Date());
    if (!session) {
      return { authenticated: false as const, mode: "anonymous" as const };
    }
    return {
      authenticated: true as const,
      mode: "user" as const,
      user: { id: session.userId, login: session.login, avatarUrl: session.avatarUrl },
    };
  });

  // Cookie-authenticated: mints a single-use ticket the client hands to the
  // WebSocket in its `session.auth` message. The socket isn't behind the
  // same-origin API proxy, so it can't rely on the browser attaching the
  // httpOnly cookie the way a same-origin fetch does -- and page JS must
  // never hold the real session id to send in its place.
  app.post("/api/auth/ws-ticket", async (request, reply) => {
    const token = sessionToken(request);
    const session = token ? await resolveSession(token, auth, new Date()) : undefined;
    if (!session) {
      await reply.code(401).send({ error: "Not signed in" });
      return;
    }
    return { ticket: auth.wsTickets.create(token!) };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const token = sessionToken(request);
    if (token) {
      const session = await resolveSession(token, auth, new Date());
      if (session) {
        await auth.db.revokeSession(token);
        // Best-effort: the client's cookie is cleared regardless of whether
        // this call succeeds.
        await fetch(`https://api.github.com/applications/${auth.clientId}/token`, {
          method: "DELETE",
          headers: {
            accept: "application/vnd.github+json",
            "content-type": "application/json",
            authorization: `Basic ${Buffer.from(`${auth.clientId}:${auth.clientSecret}`).toString("base64")}`,
            "user-agent": "sudo-city",
          },
          body: JSON.stringify({ access_token: session.tokens.accessToken }),
        }).catch((error: unknown) => {
          app.log.warn({ error }, "Failed to revoke GitHub token on logout");
        });
      }
    }
    reply.clearCookie(SESSION_COOKIE_NAME, {
      path: "/",
      secure: auth.secureCookies,
      sameSite: "lax",
    });
    await reply.code(204).send();
  });
}
