import type { Sandbox } from '@cloudflare/sandbox'
import {
  HarnessCapabilityUnsupportedError,
  type HarnessV1NetworkPolicy,
  type HarnessV1NetworkSandboxSession,
  type SandboxSession,
} from './harness'
import { CloudflareSandboxSession } from './cloudflare-sandbox-session'

const CLOUDFLARE_PROVIDER_ID = 'cloudflare-sandbox'
const DEFAULT_WORKING_DIRECTORY = '/workspace'

export class CloudflareNetworkSandboxSession
  extends CloudflareSandboxSession
  implements HarnessV1NetworkSandboxSession
{
  readonly id: string
  readonly defaultWorkingDirectory = DEFAULT_WORKING_DIRECTORY
  private readonly cloudflareSandbox: Sandbox
  private readonly hostname: string | undefined
  private readonly ownsLifecycle: boolean
  private exposedPorts: ReadonlyArray<number> = []

  constructor(input: {
    sandbox: Sandbox
    id: string
    hostname?: string
    ownsLifecycle: boolean
  }) {
    super(input.sandbox)
    this.cloudflareSandbox = input.sandbox
    this.id = input.id
    this.hostname = input.hostname
    this.ownsLifecycle = input.ownsLifecycle
  }

  get ports(): ReadonlyArray<number> {
    return this.exposedPorts
  }

  restricted(): SandboxSession {
    return new CloudflareSandboxSession(this.sandbox)
  }

  getPortUrl = async (options: {
    port: number
    protocol?: 'http' | 'https' | 'ws'
  }): Promise<string> => {
    if (!this.exposedPorts.includes(options.port)) {
      throw new HarnessCapabilityUnsupportedError({
        harnessId: CLOUDFLARE_PROVIDER_ID,
        message: `Port ${options.port} is not exposed on this sandbox. Exposed ports: [${this.exposedPorts.join(', ')}].`,
      })
    }

    if (this.hostname == null) {
      const tunnel = await this.cloudflareSandbox.tunnels.get(options.port)
      return withProtocol(tunnel.url, options.protocol)
    }

    const exposed = await this.cloudflareSandbox.exposePort(options.port, {
      hostname: this.hostname,
      token: portToken(options.port),
    })
    return withProtocol(exposed.url, options.protocol)
  }

  setNetworkPolicy = async (_policy: HarnessV1NetworkPolicy): Promise<void> => {
    throw new HarnessCapabilityUnsupportedError({
      harnessId: CLOUDFLARE_PROVIDER_ID,
      message:
        'Cloudflare Sandbox SDK does not expose a harness-compatible outbound network policy API.',
    })
  }

  setPorts = async (
    ports: ReadonlyArray<number>,
    options?: { abortSignal?: AbortSignal },
  ): Promise<void> => {
    options?.abortSignal?.throwIfAborted()

    const oldPorts = new Set(this.exposedPorts)
    const newPorts = new Set(ports)

    for (const port of oldPorts) {
      if (!newPorts.has(port)) {
        if (this.hostname == null) {
          await this.cloudflareSandbox.tunnels.destroy(port).catch(() => {})
        } else {
          await this.cloudflareSandbox.unexposePort(port).catch(() => {})
        }
      }
    }

    this.exposedPorts = [...ports]
  }

  stop = async (): Promise<void> => {
    if (!this.ownsLifecycle) return
    await this.cloudflareSandbox.setKeepAlive(false)
  }

  destroy = async (): Promise<void> => {
    if (!this.ownsLifecycle) return
    await this.cloudflareSandbox.destroy()
  }
}

function withProtocol(urlValue: string, protocol: 'http' | 'https' | 'ws' | undefined): string {
  if (protocol == null) return urlValue
  const url = new URL(urlValue)
  switch (protocol) {
    case 'http':
      url.protocol = 'https:'
      break
    case 'https':
      url.protocol = 'https:'
      break
    case 'ws':
      url.protocol = 'wss:'
      break
  }
  return url.toString()
}

function portToken(port: number): string {
  return `port-${port}`
}
