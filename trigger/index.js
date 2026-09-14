// Reliably wakes up the koala-margin-dashboard GitHub Actions refresh workflow.
// GitHub's own `schedule:` cron trigger is best-effort and was firing hours late
// (or not at all) on a low-traffic repo, so this Cloudflare Worker Cron Trigger
// calls the workflow_dispatch API directly at the intended time instead.
async function triggerWorkflow(env) {
  const resp = await fetch(
    'https://api.github.com/repos/AriannaG763/koala-margin-dashboard/actions/workflows/refresh.yml/dispatches',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.GH_PAT}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'koala-margin-dashboard-trigger-worker',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: 'main' }),
    }
  );
  const bodyText = resp.status === 204 ? '' : await resp.text();
  return { ok: resp.ok, status: resp.status, body: bodyText };
}

export default {
  async scheduled(event, env, ctx) {
    const result = await triggerWorkflow(env);
    if (!result.ok) {
      console.error('workflow_dispatch failed', result.status, result.body);
      throw new Error(`workflow_dispatch failed: ${result.status} ${result.body}`);
    }
    console.log('workflow_dispatch triggered successfully');
  },

  // Manual test endpoint, gated by a shared secret so the public workers.dev URL
  // can't be used by anyone else to spam-trigger the workflow.
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.searchParams.get('secret') !== env.TEST_SECRET) {
      return new Response('This worker only runs on a cron schedule.', { status: 403 });
    }
    const result = await triggerWorkflow(env);
    return new Response(JSON.stringify(result), {
      status: result.ok ? 200 : 502,
      headers: { 'Content-Type': 'application/json' },
    });
  },
};
