# AI SDK Cloudflare Sandbox Provider

Cloudflare Sandbox-backed provider for AI SDK Harness agents.

This package implements the Harness sandbox provider shape using Cloudflare Sandbox SDK containers. It is intended to run from a Cloudflare Worker because Cloudflare Sandbox requires a Durable Object binding.

## Install

```sh
pnpm add ai-sdk-sandbox-cloudflare @cloudflare/sandbox
```

## Cloudflare Setup

Export the Sandbox Durable Object class from your Worker entrypoint and add a binding in your Worker config.

```ts
import { createCloudflareSandbox } from 'ai-sdk-sandbox-cloudflare'
import { proxyToSandbox } from '@cloudflare/sandbox'

export { Sandbox } from '@cloudflare/sandbox'

type Env = {
  Sandbox: DurableObjectNamespace
}
```

Example `wrangler.jsonc` binding:

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

If you use Cloudflare preview URLs, call `proxyToSandbox()` before your app routes:

```ts
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const proxyResponse = await proxyToSandbox(request, env)
    if (proxyResponse) return proxyResponse

    return new Response('OK')
  },
}
```

## Use With HarnessAgent

Create the sandbox provider inside your Worker request handler, then pass it as the `sandbox` option to `HarnessAgent`.

```ts
import { HarnessAgent } from '@ai-sdk/harness'
import { createCloudflareSandbox } from 'ai-sdk-sandbox-cloudflare'
import { createCodexHarness } from '@ai-sdk/harness-codex'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const sandbox = createCloudflareSandbox({
      binding: env.Sandbox,
      id: 'agent-sandbox',
      hostname: new URL(request.url).hostname,
      sandboxOptions: {
        transport: 'rpc',
        enableDefaultSession: false,
      },
    })

    const agent = new HarnessAgent({
      harness: createCodexHarness(),
      sandbox,
    })

    const result = await agent.generate({
      prompt: 'Create a hello world TypeScript file and run it.',
    })

    return Response.json(result)
  },
}
```

## Ports

When `hostname` is provided, `getPortUrl()` uses Cloudflare Sandbox preview URLs via `exposePort()`. Without `hostname`, it falls back to quick tunnels via `sandbox.tunnels`, which require the Cloudflare Sandbox RPC transport.

## Limitations

Cloudflare Sandbox does not currently expose a harness-compatible outbound network policy API. Calls to `setNetworkPolicy()` throw `HarnessCapabilityUnsupportedError`.
