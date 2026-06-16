import { getSandbox, type Sandbox, type SandboxOptions } from '@cloudflare/sandbox'
import type { SandboxSession } from './harness'
import type {
  HarnessV1NetworkSandboxSession,
  HarnessV1SandboxProvider,
} from './harness'
import { CloudflareNetworkSandboxSession } from './cloudflare-network-sandbox-session'

export type CloudflareSandboxSettings = {
  binding: DurableObjectNamespace<Sandbox>
  id?: string
  hostname?: string
  bridgePorts?: ReadonlyArray<number>
  sandboxOptions?: SandboxOptions
}

const CLOUDFLARE_PROVIDER_ID = 'cloudflare-sandbox'
const SESSION_ID_PREFIX = 'ai-sdk-harness-session'
const DEFAULT_SANDBOX_ID = 'ai-sdk-harness'

function sandboxIdForSession(sessionId: string | undefined, fallbackId: string): string {
  return sessionId == null ? fallbackId : `${SESSION_ID_PREFIX}-${sessionId}`
}

export function createCloudflareSandbox(
  settings: CloudflareSandboxSettings,
): HarnessV1SandboxProvider {
  return new CloudflareSandboxProvider(settings)
}

export class CloudflareSandboxProvider implements HarnessV1SandboxProvider {
  readonly specificationVersion = 'harness-sandbox-v1' as const
  readonly providerId = CLOUDFLARE_PROVIDER_ID
  readonly bridgePorts?: ReadonlyArray<number>

  constructor(private readonly settings: CloudflareSandboxSettings) {
    if (settings.bridgePorts != null && settings.bridgePorts.length > 0) {
      this.bridgePorts = [...settings.bridgePorts]
    }
  }

  createSession = async (options?: {
    sessionId?: string
    abortSignal?: AbortSignal
    identity?: string
    onFirstCreate?: (
      session: SandboxSession,
      opts: { abortSignal?: AbortSignal },
    ) => Promise<void>
  }): Promise<HarnessV1NetworkSandboxSession> => {
    options?.abortSignal?.throwIfAborted()

    const sandboxId = sandboxIdForSession(
      options?.sessionId,
      this.settings.id ?? DEFAULT_SANDBOX_ID,
    )
    const sandbox = getSandbox(
      this.settings.binding,
      sandboxId,
      {
        enableDefaultSession: false,
        normalizeId: true,
        ...this.settings.sandboxOptions,
      },
    )

    const session = new CloudflareNetworkSandboxSession({
      sandbox,
      id: sandboxId,
      hostname: this.settings.hostname,
      ownsLifecycle: true,
    })

    if (options?.onFirstCreate != null) {
      await options.onFirstCreate(session.restricted(), {
        abortSignal: options.abortSignal,
      })
    }

    return session
  }

  resumeSession = async (options: {
    sessionId: string
    abortSignal?: AbortSignal
  }): Promise<HarnessV1NetworkSandboxSession> => {
    options.abortSignal?.throwIfAborted()

    const sandboxId = sandboxIdForSession(
      options.sessionId,
      this.settings.id ?? DEFAULT_SANDBOX_ID,
    )
    const sandbox = getSandbox(
      this.settings.binding,
      sandboxId,
      {
        enableDefaultSession: false,
        normalizeId: true,
        ...this.settings.sandboxOptions,
      },
    )

    return new CloudflareNetworkSandboxSession({
      sandbox,
      id: sandboxId,
      hostname: this.settings.hostname,
      ownsLifecycle: true,
    })
  }
}
