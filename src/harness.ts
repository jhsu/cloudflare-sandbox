export interface SandboxProcess {
  readonly stdout: ReadableStream<Uint8Array>
  readonly stderr: ReadableStream<Uint8Array>
  readonly wait: () => PromiseLike<{ exitCode: number }>
  readonly kill: () => PromiseLike<void>
}

export interface SandboxSession {
  readonly description: string
  readonly run: (options: {
    command: string
    workingDirectory?: string
    env?: Record<string, string>
    abortSignal?: AbortSignal
  }) => PromiseLike<{ exitCode: number; stdout: string; stderr: string }>
  readonly spawn: (options: {
    command: string
    workingDirectory?: string
    env?: Record<string, string>
    abortSignal?: AbortSignal
  }) => PromiseLike<SandboxProcess>
  readonly readFile: (options: {
    path: string
    abortSignal?: AbortSignal
  }) => PromiseLike<ReadableStream<Uint8Array> | null>
  readonly readBinaryFile: (options: {
    path: string
    abortSignal?: AbortSignal
  }) => PromiseLike<Uint8Array | null>
  readonly readTextFile: (options: {
    path: string
    encoding?: string
    startLine?: number
    endLine?: number
    abortSignal?: AbortSignal
  }) => PromiseLike<string | null>
  readonly writeFile: (options: {
    path: string
    content: ReadableStream<Uint8Array>
    abortSignal?: AbortSignal
  }) => PromiseLike<void>
  readonly writeBinaryFile: (options: {
    path: string
    content: Uint8Array
    abortSignal?: AbortSignal
  }) => PromiseLike<void>
  readonly writeTextFile: (options: {
    path: string
    content: string
    encoding?: string
    abortSignal?: AbortSignal
  }) => PromiseLike<void>
}

export class HarnessCapabilityUnsupportedError extends Error {
  readonly harnessId: string

  constructor(input: { harnessId: string; message: string }) {
    super(input.message)
    this.name = 'HarnessCapabilityUnsupportedError'
    this.harnessId = input.harnessId
  }
}

export type HarnessV1NetworkPolicy =
  | { mode: 'allow-all' }
  | { mode: 'deny-all' }
  | {
      mode: 'custom'
      allowedHosts: ReadonlyArray<string>
      allowedCIDRs?: ReadonlyArray<string>
      deniedCIDRs?: ReadonlyArray<string>
    }
  | {
      mode: 'custom'
      allowedHosts?: ReadonlyArray<string>
      allowedCIDRs: ReadonlyArray<string>
      deniedCIDRs?: ReadonlyArray<string>
    }

export interface HarnessV1NetworkSandboxSession extends SandboxSession {
  readonly id: string
  readonly defaultWorkingDirectory: string
  readonly ports: ReadonlyArray<number>
  readonly getPortUrl: (options: {
    port: number
    protocol?: 'http' | 'https' | 'ws'
  }) => PromiseLike<string>
  readonly stop: () => PromiseLike<void>
  readonly destroy?: () => PromiseLike<void>
  readonly setNetworkPolicy?: (
    policy: HarnessV1NetworkPolicy,
  ) => PromiseLike<void>
  readonly setPorts?: (
    ports: ReadonlyArray<number>,
    options?: { abortSignal?: AbortSignal },
  ) => PromiseLike<void>
  readonly restricted: () => SandboxSession
}

export interface HarnessV1SandboxProvider {
  readonly specificationVersion: 'harness-sandbox-v1'
  readonly providerId: string
  readonly bridgePorts?: ReadonlyArray<number>
  readonly createSession: (options?: {
    sessionId?: string
    abortSignal?: AbortSignal
    identity?: string
    onFirstCreate?: (
      session: SandboxSession,
      opts: { abortSignal?: AbortSignal },
    ) => Promise<void>
  }) => PromiseLike<HarnessV1NetworkSandboxSession>
  readonly resumeSession?: (options: {
    sessionId: string
    abortSignal?: AbortSignal
  }) => PromiseLike<HarnessV1NetworkSandboxSession>
}
