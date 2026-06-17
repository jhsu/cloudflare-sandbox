# AI SDK - Cloudflare Sandbox

_This package is experimental._

`HarnessV1SandboxProvider` implementation for [Cloudflare Sandbox](https://developers.cloudflare.com/sandbox/).

Cloudflare Sandbox runs inside Cloudflare Workers and uses a Durable Object binding. Unlike Vercel Sandbox, the factory does not create a VM from a Node process; it wraps Cloudflare's `getSandbox(env.Sandbox, id, options)` model and creates/resumes sandboxes by Durable Object ID.

## Setup

```bash
npm i ai-sdk-sandbox-cloudflare @cloudflare/sandbox
```

Export Cloudflare's Sandbox Durable Object from your Worker entrypoint:

```ts
export { Sandbox } from '@cloudflare/sandbox';
```

Add the Durable Object binding to `wrangler.jsonc`:

```jsonc
{
  "durable_objects": {
    "bindings": [
      {
        "name": "Sandbox",
        "class_name": "Sandbox"
      }
    ]
  },
  "migrations": [
    {
      "tag": "v1",
      "new_sqlite_classes": ["Sandbox"]
    }
  ]
}
```

## Usage

The factory is synchronous. The returned provider is stable; the actual Cloudflare Sandbox container starts lazily on the first sandbox operation.

```ts
import { createCloudflareSandbox } from 'ai-sdk-sandbox-cloudflare';
import type { Sandbox } from '@cloudflare/sandbox';

type Env = {
  Sandbox: DurableObjectNamespace<Sandbox>;
};

export default {
  async fetch(_request: Request, env: Env): Promise<Response> {
    const cloudflareSandbox = createCloudflareSandbox({
      binding: env.Sandbox,
      id: 'example-sandbox',
      sandboxOptions: {
        transport: 'rpc',
        enableDefaultSession: false,
      },
    });

    const networkSandboxSession = await cloudflareSandbox.createSession();
    const sandboxSession = networkSandboxSession.restricted();

    await sandboxSession.writeTextFile({
      path: '/workspace/hello.txt',
      content: 'hi',
    });

    const { stdout } = await sandboxSession.run({
      command: 'cat /workspace/hello.txt',
    });

    await networkSandboxSession.destroy?.();

    return Response.json({ stdout }); // { stdout: "hi" }
  },
};
```

`networkSandboxSession.restricted()` is typed as the sandbox session surface: file I/O, `run`, and `spawn`. The network sandbox session itself carries the infra surface (`ports`, `getPortUrl`, `setPorts`, `stop`, `destroy`) that only the harness should reach for.

Cloudflare options are passed through `sandboxOptions`, which maps to `@cloudflare/sandbox`'s `getSandbox(..., options)` parameter:

```ts
const sandbox = createCloudflareSandbox({
  binding: env.Sandbox,
  id: 'agent-sandbox',
  sandboxOptions: {
    transport: 'rpc',
    keepAlive: true,
    sleepAfter: '30m',
    enableDefaultSession: false,
    containerTimeouts: {
      instanceGetTimeoutMS: 30_000,
      portReadyTimeoutMS: 90_000,
    },
  },
});
```

## With HarnessAgent

Pass the provider as the `sandbox` option to `HarnessAgent`.

```ts
import { HarnessAgent } from '@ai-sdk/harness';
import { createCodexHarness } from '@ai-sdk/harness-codex';
import { createCloudflareSandbox } from 'ai-sdk-sandbox-cloudflare';
import { proxyToSandbox, type Sandbox } from '@cloudflare/sandbox';

export { Sandbox } from '@cloudflare/sandbox';

type Env = {
  Sandbox: DurableObjectNamespace<Sandbox>;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const proxyResponse = await proxyToSandbox(request, env);
    if (proxyResponse) return proxyResponse;

    const sandbox = createCloudflareSandbox({
      binding: env.Sandbox,
      id: 'codex-agent',
      hostname: new URL(request.url).hostname,
      sandboxOptions: {
        transport: 'rpc',
        enableDefaultSession: false,
      },
    });

    const agent = new HarnessAgent({
      harness: createCodexHarness(),
      sandbox,
    });

    const result = await agent.generate({
      prompt: 'Create a hello world TypeScript file and run it.',
    });

    return Response.json(result);
  },
};
```

## Sessions And Resume

When `createSession({ sessionId })` is called, the provider derives a deterministic Cloudflare sandbox ID from that session ID. `resumeSession({ sessionId })` uses the same ID and reattaches to the same Durable Object-backed sandbox.

```ts
const provider = createCloudflareSandbox({
  binding: env.Sandbox,
  sandboxOptions: { transport: 'rpc' },
});

const first = await provider.createSession({ sessionId: 'user-123' });
await first.restricted().writeTextFile({
  path: '/workspace/state.txt',
  content: 'saved',
});

const resumed = await provider.resumeSession?.({ sessionId: 'user-123' });
const text = await resumed?.restricted().readTextFile({
  path: '/workspace/state.txt',
});
```

## Ports

Harness adapters that need a bridge call `setPorts()` and `getPortUrl()` on the network sandbox session.

If `hostname` is provided, `getPortUrl()` uses Cloudflare Sandbox preview URLs through `sandbox.exposePort()`:

```ts
const provider = createCloudflareSandbox({
  binding: env.Sandbox,
  hostname: new URL(request.url).hostname,
  sandboxOptions: { transport: 'rpc' },
});

const session = await provider.createSession();
await session.setPorts?.([3000]);

const url = await session.getPortUrl({ port: 3000 });
```

Without `hostname`, `getPortUrl()` falls back to Cloudflare quick tunnels through `sandbox.tunnels.get(port)`. Quick tunnels require the RPC transport and produce `*.trycloudflare.com` URLs.

For preview URLs on your own hostname, your Worker must call `proxyToSandbox(request, env)` before application routes so Cloudflare can route exposed-port requests to the correct sandbox.

## Network Policy

Cloudflare Sandbox does not currently expose a harness-compatible outbound network policy API. Calls to `setNetworkPolicy()` throw `HarnessCapabilityUnsupportedError`.
