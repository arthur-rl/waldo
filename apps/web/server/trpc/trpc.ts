import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import { OpenApiMeta } from 'trpc-openapi';
import { type Context } from './context';
import { ratelimit } from '@server/utils/rateLimitService';

const t = initTRPC
  .context<Context>()
  .meta<OpenApiMeta>()
  .create({
    transformer: superjson,
    errorFormatter({ shape }) {
      return shape;
    },
  });

export const router = t.router;

/**
 * Unprotected procedure
 **/
export const publicProcedure = t.procedure;

/**
 * Reusable middleware to ensure
 * users are logged in
 * rate limit middleware
 */
const isAuthed = t.middleware(({ ctx, next }) => {
  if (!ctx.session || !ctx.session.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  return next({
    ctx: {
      // infers the `session` as non-nullable
      session: { ...ctx.session, user: ctx.session.user },
    },
  });
});

const isBlacklisted = t.middleware(({ ctx, next }) => {
  if (!ctx.session || !ctx.session.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  if (ctx.session.user.blacklisted) {
    throw new TRPCError({ code: 'FORBIDDEN' });
  }

  return next({
    ctx: {
      // infers the `session` as non-nullable
      session: { ...ctx.session, user: ctx.session.user },
    },
  });
});

const rateLimit = t.middleware(async ({ ctx, next }) => {
  const identity = ctx.session?.user?.id;
  if (!identity)
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'No user with the current session found.',
    });
  const result = await ratelimit.limit(identity);
  if (!result.success) {
    throw new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many requests.',
    });
  }

  return next({
    ctx: {
      // infers the `session` as non-nullable
      session: { ...ctx.session, user: ctx.session?.user },
    },
  });
});

/**
 * Protected procedure
 **/
export const protectedProcedure = t.procedure
  .use(isAuthed)
  .use(isBlacklisted)
  .use(rateLimit);
