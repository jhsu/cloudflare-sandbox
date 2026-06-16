import { posix } from 'node:path'
import type { ISandbox, Process } from '@cloudflare/sandbox'
import type { SandboxProcess, SandboxSession } from './harness'

export class CloudflareSandboxSession implements SandboxSession {
  constructor(protected readonly sandbox: ISandbox) {}

  get description(): string {
    return [
      'Cloudflare Sandbox.',
      'Filesystem changes persist for the lifetime of the sandbox container.',
    ].join('\n')
  }

  async run({
    command,
    workingDirectory,
    env,
    abortSignal,
  }: {
    command: string
    workingDirectory?: string
    env?: Record<string, string>
    abortSignal?: AbortSignal
  }): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    abortSignal?.throwIfAborted()

    const result = await this.sandbox.exec(command, {
      ...(workingDirectory !== undefined ? { cwd: workingDirectory } : {}),
      ...(env !== undefined ? { env } : {}),
    })

    abortSignal?.throwIfAborted()
    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    }
  }

  async spawn({
    command,
    workingDirectory,
    env,
    abortSignal,
  }: {
    command: string
    workingDirectory?: string
    env?: Record<string, string>
    abortSignal?: AbortSignal
  }): Promise<SandboxProcess> {
    abortSignal?.throwIfAborted()

    const process = await this.sandbox.startProcess(command, {
      ...(workingDirectory !== undefined ? { cwd: workingDirectory } : {}),
      ...(env !== undefined ? { env } : {}),
      autoCleanup: false,
    })

    return createSandboxProcess(this.sandbox, process, abortSignal)
  }

  async readFile({
    path,
    abortSignal,
  }: {
    path: string
    abortSignal?: AbortSignal
  }): Promise<ReadableStream<Uint8Array> | null> {
    abortSignal?.throwIfAborted()
    try {
      const result = await this.sandbox.readFile(path, { encoding: 'none' })
      return result.content
    } catch (error) {
      if (isFileNotFoundError(error)) return null
      throw error
    }
  }

  async readBinaryFile({
    path,
    abortSignal,
  }: {
    path: string
    abortSignal?: AbortSignal
  }): Promise<Uint8Array | null> {
    const stream = await this.readFile({ path, abortSignal })
    if (stream == null) return null
    return collectStream(stream)
  }

  async readTextFile({
    path,
    encoding = 'utf-8',
    startLine,
    endLine,
    abortSignal,
  }: {
    path: string
    encoding?: string
    startLine?: number
    endLine?: number
    abortSignal?: AbortSignal
  }): Promise<string | null> {
    abortSignal?.throwIfAborted()
    try {
      const result = await this.sandbox.readFile(path, { encoding: encoding as 'utf-8' })
      return extractLines(result.content, startLine, endLine)
    } catch (error) {
      if (isFileNotFoundError(error)) return null
      throw error
    }
  }

  async writeFile({
    path,
    content,
    abortSignal,
  }: {
    path: string
    content: ReadableStream<Uint8Array>
    abortSignal?: AbortSignal
  }): Promise<void> {
    abortSignal?.throwIfAborted()
    await this.ensureParentDirectory(path)
    await this.sandbox.writeFile(path, content)
  }

  async writeBinaryFile({
    path,
    content,
    abortSignal,
  }: {
    path: string
    content: Uint8Array
    abortSignal?: AbortSignal
  }): Promise<void> {
    abortSignal?.throwIfAborted()
    await this.writeFile({ path, content: bytesToStream(content), abortSignal })
  }

  async writeTextFile({
    path,
    content,
    encoding = 'utf-8',
    abortSignal,
  }: {
    path: string
    content: string
    encoding?: string
    abortSignal?: AbortSignal
  }): Promise<void> {
    abortSignal?.throwIfAborted()
    await this.ensureParentDirectory(path)
    await this.sandbox.writeFile(path, content, { encoding })
  }

  private async ensureParentDirectory(path: string): Promise<void> {
    const parent = posix.dirname(path)
    if (parent && parent !== '.' && parent !== '/') {
      await this.sandbox.mkdir(parent, { recursive: true })
    }
  }
}

function createSandboxProcess(
  sandbox: ISandbox,
  process: Process,
  abortSignal: AbortSignal | undefined,
): SandboxProcess {
  const stdout = new ReadableStream<Uint8Array>()
  const stderr = new ReadableStream<Uint8Array>()

  return {
    stdout,
    stderr,
    async wait(): Promise<{ exitCode: number }> {
      while (true) {
        abortSignal?.throwIfAborted()
        const current = await sandbox.getProcess(process.id)
        if (current == null) return { exitCode: process.exitCode ?? 0 }
        if (current.exitCode != null) return { exitCode: current.exitCode }
        if (['completed', 'failed', 'killed', 'error'].includes(current.status)) {
          return { exitCode: current.exitCode ?? 1 }
        }
        await new Promise(resolve => setTimeout(resolve, 250))
      }
    },
    async kill(): Promise<void> {
      await sandbox.killProcess(process.id)
    },
  }
}

function bytesToStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
}

async function collectStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    if (value) {
      chunks.push(value)
      total += value.byteLength
    }
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

function isFileNotFoundError(error: unknown): boolean {
  if (error == null || typeof error !== 'object') return false
  const message = (error as { message?: unknown }).message
  return typeof message === 'string' && /no such file|not found|does not exist|ENOENT/i.test(message)
}

function extractLines(
  text: string,
  startLine: number | undefined,
  endLine: number | undefined,
): string {
  if (startLine == null && endLine == null) return text

  const lines = text.split('\n')
  const start = Math.max((startLine ?? 1) - 1, 0)
  const end = endLine == null ? lines.length : Math.max(endLine, start)
  return lines.slice(start, end).join('\n')
}
