/* ==========================================================================
   tools/push-cron-worker/worker.js — the clock (Sprint 11)

   Cloudflare Pages Functions cannot be cron-triggered. Pages compiles the
   functions/ directory into request handlers only; there is no scheduled
   handler to declare and no [triggers] block that Pages will honour. So the
   dispatcher at /api/push/dispatch has a clock but no alarm — something has to
   call it.

   That something is this: a standalone Worker whose entire job is to POST to
   the dispatcher once a minute with the shared secret. It holds no data, no
   VAPID key and no D1 binding — the whole reminder engine stays inside the
   Pages project, and this Worker can be deleted and recreated at will.

   Deploy (from this directory):
     wrangler secret put PUSH_DISPATCH_SECRET     # same value as on Pages
     wrangler deploy

   Verify without waiting for the cron:
     curl https://<this-worker>.workers.dev/            → runs one cycle now
   ========================================================================== */

async function runOnce(env) {
  const target = env.DISPATCH_URL;
  if (!target || !env.PUSH_DISPATCH_SECRET) {
    return { ok: false, error: 'DISPATCH_URL or PUSH_DISPATCH_SECRET is not set' };
  }

  try {
    const res = await fetch(target, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + env.PUSH_DISPATCH_SECRET,
        'Content-Type': 'application/json'
      },
      body: '{}'
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, body: text.slice(0, 2000) };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

export default {
  async scheduled(event, env, ctx) {
    // waitUntil, not await: the cron invocation must not be billed for the
    // whole round-trip, and a slow push service must not stall the schedule
    ctx.waitUntil(runOnce(env));
  },

  /* a manual trigger, so the pipe can be proven end-to-end without waiting for
     the next minute boundary — the dispatcher itself is still secret-gated */
  async fetch(request, env) {
    const out = await runOnce(env);
    return new Response(JSON.stringify(out, null, 2), {
      status: out.ok ? 200 : 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }
};
