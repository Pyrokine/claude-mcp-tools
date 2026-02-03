/**
 * CDP (Chrome DevTools Protocol) 客户端
 *
 * 基于 WebSocket 实现，不依赖 Puppeteer
 * 参考 Puppeteer 的实现原理，但更轻量
 */

import {EventEmitter} from 'events'
import WebSocket from 'ws'
import {CDPError, ConnectionRefusedError, TimeoutError} from '../core/errors.js'

/**
 * CDP 消息回调
 */
interface PendingCallback {
    resolve: (result: unknown) => void;
    reject: (error: Error) => void;
    method: string;
}

/**
 * CDP 事件监听器
 */
type CDPEventListener = (params: unknown) => void;

/**
 * CDP 客户端
 */
export class CDPClient extends EventEmitter {
    /** 默认命令超时 */
    private static readonly DEFAULT_COMMAND_TIMEOUT = 30000
    private ws: WebSocket | null = null
    private callbacks            = new Map<number, PendingCallback>()
    private nextId               = 1
    private eventListeners       = new Map<string, Set<CDPEventListener>>()

    private _endpoint: string    = ''

    get endpoint(): string {
        return this._endpoint
    }

    get isConnected(): boolean {
        return this.ws !== null && this.ws.readyState === WebSocket.OPEN
    }

    /**
     * 连接到 CDP 端点
     */
    async connect(endpoint: string, timeout = 30000): Promise<void> {
        this._endpoint = endpoint

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new TimeoutError(`连接超时: ${endpoint} (${timeout}ms)`))
            }, timeout)

            try {
                this.ws = new WebSocket(endpoint)
            } catch (error) {
                clearTimeout(timer)
                // 解析 host 和 port
                const match = endpoint.match(/ws:\/\/([^:]+):(\d+)/)
                if (match) {
                    reject(new ConnectionRefusedError(match[1], parseInt(match[2], 10)))
                } else {
                    reject(new CDPError(`无法连接到 ${endpoint}`))
                }
                return
            }

            this.ws.on('open', () => {
                clearTimeout(timer)
                resolve()
            })

            this.ws.on('error', (error: Error) => {
                clearTimeout(timer)
                // 解析 host 和 port
                const match = endpoint.match(/ws:\/\/([^:]+):(\d+)/)
                if (match && error.message.includes('ECONNREFUSED')) {
                    reject(new ConnectionRefusedError(match[1], parseInt(match[2], 10)))
                } else {
                    reject(new CDPError(error.message))
                }
            })

            this.ws.on('message', (data: WebSocket.Data) => {
                this.handleMessage(data)
            })

            this.ws.on('close', () => {
                this.handleClose()
            })
        })
    }

    /**
     * 发送 CDP 命令
     */
    async send<T = unknown>(
        method: string,
        params?: object,
        sessionId?: string,
        timeout: number = CDPClient.DEFAULT_COMMAND_TIMEOUT,
    ): Promise<T> {
        if (!this.isConnected) {
            throw new CDPError('CDP 客户端未连接')
        }

        const id                               = this.nextId++
        const message: Record<string, unknown> = {id, method}

        if (params !== undefined) {
            message.params = params
        }
        if (sessionId !== undefined) {
            message.sessionId = sessionId
        }

        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                this.callbacks.delete(id)
                reject(new CDPError(`CDP 命令超时: ${method} (${timeout}ms)`))
            }, timeout)

            this.callbacks.set(id, {
                resolve: (result: unknown) => {
                    clearTimeout(timeoutId)
                    resolve(result as T)
                },
                reject: (error: Error) => {
                    clearTimeout(timeoutId)
                    reject(error)
                },
                method,
            })
            this.ws!.send(JSON.stringify(message))
        })
    }

    /**
     * 监听 CDP 事件
     */
    onEvent(event: string, listener: CDPEventListener): void {
        if (!this.eventListeners.has(event)) {
            this.eventListeners.set(event, new Set())
        }
        this.eventListeners.get(event)!.add(listener)
    }

    /**
     * 移除 CDP 事件监听
     */
    offEvent(event: string, listener: CDPEventListener): void {
        const listeners = this.eventListeners.get(event)
        if (listeners) {
            listeners.delete(listener)
        }
    }

    /**
     * 等待特定事件
     */
    waitForEvent<T = unknown>(
        event: string,
        predicate?: (params: T) => boolean,
        timeout = 30000,
    ): Promise<T> {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.offEvent(event, listener)
                reject(new TimeoutError(`等待事件超时: ${event} (${timeout}ms)`))
            }, timeout)

            const listener: CDPEventListener = (params) => {
                if (!predicate || predicate(params as T)) {
                    clearTimeout(timer)
                    this.offEvent(event, listener)
                    resolve(params as T)
                }
            }

            this.onEvent(event, listener)
        })
    }

    /**
     * 关闭连接
     */
    close(): void {
        // 先拒绝所有等待中的回调
        for (const [id, callback] of this.callbacks) {
            callback.reject(new CDPError('连接主动关闭'))
        }
        this.callbacks.clear()
        this.eventListeners.clear()

        // 关闭 WebSocket
        if (this.ws) {
            this.ws.close()
            this.ws = null
        }
    }

    /**
     * 处理收到的消息
     */
    private handleMessage(data: WebSocket.Data): void {
        let message: {
            id?: number;
            method?: string;
            params?: unknown;
            result?: unknown;
            error?: { message: string; code?: number };
        }

        try {
            message = JSON.parse(data.toString())
        } catch {
            console.error('CDP: 无法解析消息', data.toString())
            return
        }

        // 响应消息
        if (message.id !== undefined) {
            const callback = this.callbacks.get(message.id)
            if (callback) {
                this.callbacks.delete(message.id)
                if (message.error) {
                    callback.reject(
                        new CDPError(`${callback.method}: ${message.error.message}`),
                    )
                } else {
                    callback.resolve(message.result)
                }
            }
            return
        }

        // 事件消息
        if (message.method) {
            const listeners = this.eventListeners.get(message.method)
            if (listeners) {
                for (const listener of listeners) {
                    try {
                        listener(message.params)
                    } catch (error) {
                        console.error(`CDP 事件处理错误 (${message.method}):`, error)
                    }
                }
            }
            // 也触发通用事件
            this.emit(message.method, message.params)
        }
    }

    /**
     * 处理连接关闭
     */
    private handleClose(): void {
        // 拒绝所有等待中的回调
        for (const [id, callback] of this.callbacks) {
            callback.reject(new CDPError('连接已关闭'))
            this.callbacks.delete(id)
        }
        this.emit('disconnected')
    }
}

/** 默认 HTTP 请求超时 */
const DEFAULT_HTTP_TIMEOUT = 10000

/**
 * 获取浏览器 WebSocket 端点
 */
export async function getBrowserWSEndpoint(
    host: string,
    port: number,
    timeout: number = DEFAULT_HTTP_TIMEOUT,
): Promise<string> {
    const url        = `http://${host}:${port}/json/version`
    const controller = new AbortController()
    const timeoutId  = setTimeout(() => controller.abort(), timeout)

    try {
        const response = await fetch(url, {signal: controller.signal})

        if (!response.ok) {
            throw new ConnectionRefusedError(host, port)
        }
        const data = (await response.json()) as { webSocketDebuggerUrl: string }
        return data.webSocketDebuggerUrl
    } catch (error) {
        if (error instanceof ConnectionRefusedError) {
            throw error
        }
        // AbortError 表示超时
        if (error instanceof Error && error.name === 'AbortError') {
            throw new TimeoutError(`连接超时: ${host}:${port} (${timeout}ms)`)
        }
        throw new ConnectionRefusedError(host, port)
    } finally {
        clearTimeout(timeoutId)
    }
}

/**
 * 获取所有可用的 targets
 */
export async function getTargets(
    host: string,
    port: number,
    timeout: number = DEFAULT_HTTP_TIMEOUT,
): Promise<
    Array<{
        id: string;
        type: string;
        url: string;
        title: string;
        webSocketDebuggerUrl: string;
    }>
> {
    const url        = `http://${host}:${port}/json/list`
    const controller = new AbortController()
    const timeoutId  = setTimeout(() => controller.abort(), timeout)

    try {
        const response = await fetch(url, {signal: controller.signal})

        if (!response.ok) {
            throw new ConnectionRefusedError(host, port)
        }
        return (await response.json()) as Array<{
            id: string;
            type: string;
            url: string;
            title: string;
            webSocketDebuggerUrl: string;
        }>
    } catch (error) {
        if (error instanceof ConnectionRefusedError) {
            throw error
        }
        // AbortError 表示超时
        if (error instanceof Error && error.name === 'AbortError') {
            throw new TimeoutError(`连接超时: ${host}:${port} (${timeout}ms)`)
        }
        throw new ConnectionRefusedError(host, port)
    } finally {
        clearTimeout(timeoutId)
    }
}
