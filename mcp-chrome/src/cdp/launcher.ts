/**
 * 浏览器启动器
 *
 * 负责启动 Chrome 浏览器进程并获取 CDP 端点
 */

import {ChildProcess, spawn} from 'child_process'
import {existsSync} from 'fs'
import {platform} from 'os'
import {BrowserNotFoundError, TimeoutError} from '../core/errors.js'
import type {LaunchOptions} from '../core/types.js'

/**
 * Chrome 可执行文件的常见路径
 */
const CHROME_PATHS: Record<string, string[]> = {
    linux: [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/snap/bin/chromium',
    ],
    darwin: [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ],
    win32: [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    ],
}

/**
 * 查找 Chrome 可执行文件
 */
export function findChrome(): string | null {
    const paths = CHROME_PATHS[platform()] ?? []

    for (const p of paths) {
        if (existsSync(p)) {
            return p
        }
    }

    return null
}

/**
 * 浏览器启动器
 */
export class BrowserLauncher {
    private process: ChildProcess | null = null
    private _port: number                = 0

    get port(): number {
        return this._port
    }

    private _endpoint: string = ''

    get endpoint(): string {
        return this._endpoint
    }

    get isRunning(): boolean {
        return this.process !== null && !this.process.killed
    }

    /**
     * 启动浏览器
     */
    async launch(options: LaunchOptions = {}): Promise<string> {
        const {
                  executablePath,
                  port      = 0,
                  incognito = false,
                  headless  = false,
                  userDataDir,
                  timeout   = 30000,
              } = options

        // 查找 Chrome
        const chromePath = executablePath ?? findChrome()
        if (!chromePath) {
            throw new BrowserNotFoundError()
        }

        // 构建启动参数
        const args = this.buildArgs({port, incognito, headless, userDataDir})

        // 启动进程
        this.process = spawn(chromePath, args, {
            detached: false,
            stdio: ['ignore', 'pipe', 'pipe'],
        })

        // 等待 CDP 端点就绪
        this._endpoint = await this.waitForEndpoint(timeout)
        return this._endpoint
    }

    /**
     * 关闭浏览器
     */
    close(): void {
        if (this.process && !this.process.killed) {
            this.process.kill('SIGTERM')
            this.process = null
        }
    }

    /**
     * 强制关闭浏览器
     */
    forceClose(): void {
        if (this.process && !this.process.killed) {
            this.process.kill('SIGKILL')
            this.process = null
        }
    }

    /**
     * 构建启动参数
     */
    private buildArgs(options: {
        port: number;
        incognito: boolean;
        headless: boolean;
        userDataDir?: string;
    }): string[] {
        const args = [
            `--remote-debugging-port=${options.port}`,
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-background-networking',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-breakpad',
            '--disable-component-extensions-with-background-pages',
            '--disable-component-update',
            '--disable-default-apps',
            '--disable-dev-shm-usage',
            '--disable-extensions',
            '--disable-features=TranslateUI',
            '--disable-hang-monitor',
            '--disable-ipc-flooding-protection',
            '--disable-popup-blocking',
            '--disable-prompt-on-repost',
            '--disable-renderer-backgrounding',
            '--disable-sync',
            '--enable-features=NetworkService,NetworkServiceInProcess',
            '--force-color-profile=srgb',
            '--metrics-recording-only',
            '--password-store=basic',
            '--use-mock-keychain',
        ]

        if (options.incognito) {
            args.push('--incognito')
        }

        if (options.headless) {
            args.push('--headless=new')
        }

        if (options.userDataDir) {
            args.push(`--user-data-dir=${options.userDataDir}`)
        }

        // 打开一个空白页
        args.push('about:blank')

        return args
    }

    /**
     * 等待 CDP 端点就绪
     */
    private waitForEndpoint(timeout: number): Promise<string> {
        return new Promise((resolve, reject) => {
            if (!this.process) {
                reject(new Error('浏览器进程未启动'))
                return
            }

            const timer = setTimeout(() => {
                reject(new TimeoutError(`等待浏览器启动超时 (${timeout}ms)`))
            }, timeout)

            let stderr = ''

            this.process.stderr?.on('data', (data: Buffer) => {
                stderr += data.toString()

                // 解析 DevTools listening on ws://...
                const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/)
                if (match) {
                    clearTimeout(timer)
                    // 解析端口
                    const portMatch = match[1].match(/:(\d+)\//)
                    if (portMatch) {
                        this._port = parseInt(portMatch[1], 10)
                    }
                    resolve(match[1])
                }
            })

            this.process.on('error', (error: Error) => {
                clearTimeout(timer)
                reject(error)
            })

            this.process.on('exit', (code) => {
                clearTimeout(timer)
                if (code !== 0 && code !== null) {
                    reject(new Error(`浏览器进程退出，代码: ${code}\n${stderr}`))
                }
            })
        })
    }
}
