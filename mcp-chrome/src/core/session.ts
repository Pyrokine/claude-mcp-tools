/**
 * 会话管理
 *
 * 管理浏览器会话，包括：
 * - CDP 客户端
 * - 反检测注入
 * - 页面状态
 * - 日志收集
 */

import {BehaviorSimulator, getAntiDetectionScript} from '../anti-detection/index.js'
import {BrowserLauncher, CDPClient, getBrowserWSEndpoint, getTargets} from '../cdp/index.js'
import {AutoWait} from './auto-wait.js'
import {NavigationTimeoutError, SessionNotFoundError, TargetNotFoundError} from './errors.js'
import {Locator} from './locator.js'
import type {
    ConnectOptions,
    ConsoleLogEntry,
    Cookie,
    CookieOptions,
    LaunchOptions,
    NetworkRequestEntry,
    PageState,
    Target,
    TargetInfo,
    WaitUntil,
} from './types.js'

/**
 * 会话状态
 */
interface SessionState {
    url: string;
    title: string;
    targetId: string;
}

/**
 * 会话管理器（单例）
 */
class SessionManager {
    private static instance: SessionManager
    // 日志收集（环形缓冲区，限制最大条数避免内存泄漏）
    private static readonly MAX_LOG_ENTRIES        = 1000
    private launcher: BrowserLauncher | null           = null
    private cdp: CDPClient | null                      = null
    private sessionId: string | null                   = null
    private currentTargetId: string | null             = null
    private state: SessionState | null                 = null
    private behaviorSimulator                          = new BehaviorSimulator()
    private stealthMode: 'off' | 'safe' | 'aggressive' = 'safe'
    // 操作锁（防止并发竞态）
    private operationLock: Promise<void> = Promise.resolve()
    private consoleLogs: ConsoleLogEntry[]         = []
    private networkRequests: NetworkRequestEntry[] = []
    private requestMap                             = new Map<string, {
        url: string;
        method: string;
        type: string;
        timestamp: number
    }>()

    // 监听器安装标志（防止重复安装）
    private listenersInstalled = false

    private constructor() {
    }

    static getInstance(): SessionManager {
        if (!SessionManager.instance) {
            SessionManager.instance = new SessionManager()
        }
        return SessionManager.instance
    }

    /**
     * 启动浏览器
     */
    async launch(options: LaunchOptions = {}): Promise<TargetInfo> {
        return this.withLock(async () => {
            // 关闭现有会话
            await this.close()

            // 保存 stealth 模式
            this.stealthMode = options.stealth ?? 'safe'

            // 启动浏览器
            this.launcher  = new BrowserLauncher()
            const endpoint = await this.launcher.launch(options)

            // 连接 CDP
            this.cdp = new CDPClient()
            await this.cdp.connect(endpoint, options.timeout)

            // 获取第一个页面
            const targets    = await getTargets('127.0.0.1', this.launcher.port)
            const pageTarget = targets.find((t) => t.type === 'page')

            if (!pageTarget) {
                throw new Error('未找到页面')
            }

            // 附加到页面
            await this.attachToTarget(pageTarget.id)

            return {
                targetId: pageTarget.id,
                type: pageTarget.type,
                url: pageTarget.url,
                title: pageTarget.title,
            }
        })
    }

    /**
     * 连接到已运行的浏览器
     */
    async connect(options: ConnectOptions): Promise<TargetInfo> {
        return this.withLock(async () => {
            const {host = '127.0.0.1', port, timeout = 30000, stealth = 'safe'} = options

            // 关闭现有会话
            await this.close()

            // 保存 stealth 模式
            this.stealthMode = stealth

            // 获取 WebSocket 端点
            const endpoint = await getBrowserWSEndpoint(host, port)

            // 连接 CDP
            this.cdp = new CDPClient()
            await this.cdp.connect(endpoint, timeout)

            // 获取第一个页面
            const targets    = await getTargets(host, port)
            const pageTarget = targets.find((t) => t.type === 'page')

            if (!pageTarget) {
                throw new Error('未找到页面')
            }

            // 附加到页面
            await this.attachToTarget(pageTarget.id)

            return {
                targetId: pageTarget.id,
                type: pageTarget.type,
                url: pageTarget.url,
                title: pageTarget.title,
            }
        })
    }

    /**
     * 列出所有可用页面
     */
    async listTargets(): Promise<TargetInfo[]> {
        this.ensureConnected()

        // 从 CDP 获取 targets
        const {targetInfos} = (await this.cdp!.send('Target.getTargets')) as {
            targetInfos: Array<{
                targetId: string;
                type: string;
                url: string;
                title: string;
            }>;
        }

        return targetInfos
            .filter((t) => t.type === 'page')
            .map((t) => ({
                targetId: t.targetId,
                type: t.type,
                url: t.url,
                title: t.title,
            }))
    }

    /**
     * 附加到指定页面
     */
    async attachToTarget(targetId: string): Promise<void> {
        this.ensureConnected()

        // 如果已经附加到同一个 target，跳过
        if (this.currentTargetId === targetId && this.sessionId) {
            return
        }

        // 如果有之前的 session，先分离
        if (this.sessionId) {
            try {
                await this.cdp!.send('Target.detachFromTarget', {
                    sessionId: this.sessionId,
                })
            } catch {
                // 忽略分离错误
            }
        }

        // 附加到目标
        const {sessionId} = (await this.cdp!.send('Target.attachToTarget', {
            targetId,
            flatten: true,
        })) as { sessionId: string }

        this.sessionId       = sessionId
        this.currentTargetId = targetId

        // 初始化会话
        await this.initSession()
    }

    /**
     * 导航到 URL
     */
    async navigate(
        url: string,
        options: { wait?: WaitUntil; timeout?: number } = {},
    ): Promise<void> {
        return this.withLock(async () => {
            this.ensureSession()

            const {wait = 'load', timeout = 30000} = options

            // 导航
            const {errorText} = (await this.send('Page.navigate', {url})) as {
                errorText?: string;
            }

            if (errorText) {
                throw new NavigationTimeoutError(url, timeout)
            }

            // 根据 wait 类型等待
            if (wait === 'networkidle') {
                await this.waitForNetworkIdle(timeout)
            } else {
                const eventName =
                          wait === 'domcontentloaded'
                          ? 'Page.domContentEventFired'
                          : 'Page.loadEventFired'
                await this.cdp!.waitForEvent(eventName, undefined, timeout)
            }

            // 更新状态
            await this.updateState()
        })
    }

    /**
     * 等待网络空闲（无进行中的请求且持续指定时间）
     */
    async waitForNetworkIdle(timeout: number, idleTime: number = 500): Promise<void> {
        this.ensureSession()

        // 使用局部 Set 追踪本次等待的请求，避免污染成员变量
        const localPendingRequests = new Set<string>()

        return new Promise((resolve, reject) => {
            let idleTimer: NodeJS.Timeout | null    = null
            let timeoutTimer: NodeJS.Timeout | null = null

            const checkIdle = () => {
                if (localPendingRequests.size === 0) {
                    if (idleTimer === null) {
                        idleTimer = setTimeout(() => {
                            cleanup()
                            resolve()
                        }, idleTime)
                    }
                } else {
                    if (idleTimer !== null) {
                        clearTimeout(idleTimer)
                        idleTimer = null
                    }
                }
            }

            const onRequestStart = (params: unknown) => {
                const {requestId} = params as { requestId: string }
                localPendingRequests.add(requestId)
                checkIdle()
            }

            const onRequestEnd = (params: unknown) => {
                const {requestId} = params as { requestId: string }
                localPendingRequests.delete(requestId)
                checkIdle()
            }

            const cleanup = () => {
                if (idleTimer !== null) {
                    clearTimeout(idleTimer)
                }
                if (timeoutTimer !== null) {
                    clearTimeout(timeoutTimer)
                }
                this.cdp!.offEvent('Network.requestWillBeSent', onRequestStart)
                this.cdp!.offEvent('Network.loadingFinished', onRequestEnd)
                this.cdp!.offEvent('Network.loadingFailed', onRequestEnd)
            }

            // 超时处理
            timeoutTimer = setTimeout(() => {
                cleanup()
                reject(new NavigationTimeoutError('networkidle', timeout))
            }, timeout)

            // 监听网络事件
            this.cdp!.onEvent('Network.requestWillBeSent', onRequestStart)
            this.cdp!.onEvent('Network.loadingFinished', onRequestEnd)
            this.cdp!.onEvent('Network.loadingFailed', onRequestEnd)

            // 初始检查
            checkIdle()
        })
    }

    /**
     * 等待导航完成（Page.loadEventFired 事件）
     */
    async waitForNavigation(timeout: number = 30000): Promise<void> {
        this.ensureSession()
        await this.cdp!.waitForEvent('Page.loadEventFired', undefined, timeout)
    }

    /**
     * 后退
     */
    async goBack(): Promise<void> {
        this.ensureSession()
        await this.send('Page.goBack')
        await this.updateState()
    }

    /**
     * 前进
     */
    async goForward(): Promise<void> {
        this.ensureSession()
        await this.send('Page.goForward')
        await this.updateState()
    }

    /**
     * 刷新
     */
    async reload(options: { ignoreCache?: boolean; timeout?: number } = {}): Promise<void> {
        this.ensureSession()

        const {ignoreCache = false, timeout = 30000} = options

        const waitPromise = this.cdp!.waitForEvent(
            'Page.loadEventFired',
            undefined,
            timeout,
        )

        await this.send('Page.reload', {ignoreCache})

        await waitPromise
        await this.updateState()
    }

    /**
     * 创建定位器
     */
    createLocator(target: Target, options?: { timeout?: number }): Locator {
        this.ensureSession()
        return new Locator(this.cdp!, target, this.sessionId!, {
            ...options,
            getUrl: () => this.state?.url,
        })
    }

    /**
     * 创建自动等待器
     */
    createAutoWait(options?: { timeout?: number }): AutoWait {
        this.ensureSession()
        return new AutoWait(this.cdp!, this.sessionId!, options)
    }

    /**
     * 获取行为模拟器
     */
    getBehaviorSimulator(): BehaviorSimulator {
        return this.behaviorSimulator
    }

    /**
     * 鼠标移动
     */
    async mouseMove(x: number, y: number): Promise<void> {
        this.ensureSession()
        await this.send('Input.dispatchMouseEvent', {
            type: 'mouseMoved',
            x,
            y,
        })
        this.behaviorSimulator.setCurrentPosition({x, y})
    }

    /**
     * 鼠标按下
     */
    async mouseDown(
        button: 'left' | 'middle' | 'right' | 'back' | 'forward' = 'left',
    ): Promise<void> {
        this.ensureSession()
        await this.send('Input.dispatchMouseEvent', {
            type: 'mousePressed',
            button,
            clickCount: 1,
            x: this.behaviorSimulator.getCurrentPosition().x,
            y: this.behaviorSimulator.getCurrentPosition().y,
        })
    }

    /**
     * 鼠标释放
     */
    async mouseUp(
        button: 'left' | 'middle' | 'right' | 'back' | 'forward' = 'left',
    ): Promise<void> {
        this.ensureSession()
        await this.send('Input.dispatchMouseEvent', {
            type: 'mouseReleased',
            button,
            clickCount: 1,
            x: this.behaviorSimulator.getCurrentPosition().x,
            y: this.behaviorSimulator.getCurrentPosition().y,
        })
    }

    /**
     * 滚轮
     */
    async mouseWheel(deltaX: number, deltaY: number): Promise<void> {
        this.ensureSession()
        const pos = this.behaviorSimulator.getCurrentPosition()
        await this.send('Input.dispatchMouseEvent', {
            type: 'mouseWheel',
            x: pos.x,
            y: pos.y,
            deltaX,
            deltaY,
        })
    }

    /**
     * 键盘按下
     */
    async keyDown(key: string): Promise<void> {
        this.ensureSession()
        const keyDefinition = getKeyDefinition(key)
        await this.send('Input.dispatchKeyEvent', {
            type: 'keyDown',
            ...keyDefinition,
        })
    }

    /**
     * 键盘释放
     */
    async keyUp(key: string): Promise<void> {
        this.ensureSession()
        const keyDefinition = getKeyDefinition(key)
        await this.send('Input.dispatchKeyEvent', {
            type: 'keyUp',
            ...keyDefinition,
        })
    }

    /**
     * 输入文本
     */
    async type(text: string, delay = 0): Promise<void> {
        this.ensureSession()
        for (const char of text) {
            await this.send('Input.dispatchKeyEvent', {
                type: 'keyDown',
                text: char,
            })
            await this.send('Input.dispatchKeyEvent', {
                type: 'keyUp',
                text: char,
            })
            if (delay > 0) {
                await new Promise((r) => setTimeout(r, delay))
            }
        }
    }

    /**
     * 触屏开始
     */
    async touchStart(x: number, y: number): Promise<void> {
        this.ensureSession()
        await this.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [{x, y}],
        })
    }

    /**
     * 触屏移动
     */
    async touchMove(x: number, y: number): Promise<void> {
        this.ensureSession()
        await this.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [{x, y}],
        })
    }

    /**
     * 触屏结束
     */
    async touchEnd(): Promise<void> {
        this.ensureSession()
        await this.send('Input.dispatchTouchEvent', {
            type: 'touchEnd',
            touchPoints: [],
        })
    }

    /**
     * 截图
     */
    async screenshot(fullPage = false): Promise<string> {
        this.ensureSession()

        if (fullPage) {
            // 获取页面完整高度
            const {result} = (await this.send('Runtime.evaluate', {
                expression:
                    'JSON.stringify({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight })',
                returnByValue: true,
            })) as { result: { value: string } }

            const {width, height} = JSON.parse(result.value)

            // 设置视口
            await this.send('Emulation.setDeviceMetricsOverride', {
                width,
                height,
                deviceScaleFactor: 1,
                mobile: false,
            })
        }

        const {data} = (await this.send('Page.captureScreenshot', {
            format: 'png',
        })) as { data: string }

        if (fullPage) {
            // 恢复视口
            await this.send('Emulation.clearDeviceMetricsOverride')
        }

        return data
    }

    /**
     * 获取页面状态
     */
    async getPageState(): Promise<PageState> {
        this.ensureSession()

        // 获取基本信息
        const {result} = (await this.send('Runtime.evaluate', {
            expression: `JSON.stringify({
        url: location.href,
        title: document.title,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight
        }
      })`,
            returnByValue: true,
        })) as { result: { value: string } }

        const state = JSON.parse(result.value) as PageState

        // 获取可交互元素
        await this.send('Accessibility.enable')
        const {nodes} = (await this.send('Accessibility.getFullAXTree')) as {
            nodes: Array<{
                role: { value: string };
                name?: { value: string };
                description?: { value: string };
                properties?: Array<{ name: string; value: { value: unknown } }>;
            }>;
        }

        const interactiveRoles = [
            'button',
            'link',
            'textbox',
            'checkbox',
            'radio',
            'combobox',
            'listbox',
            'menuitem',
            'tab',
            'slider',
            'spinbutton',
            'switch',
        ]

        state.elements = nodes
            .filter((n) => interactiveRoles.includes(n.role?.value?.toLowerCase() ?? ''))
            .map((n) => {
                const props   = n.properties ?? []
                const getProp = (name: string) =>
                    props.find((p) => p.name === name)?.value?.value

                return {
                    role: n.role?.value ?? '',
                    name: n.name?.value ?? '',
                    description: n.description?.value,
                    disabled: getProp('disabled') as boolean | undefined,
                    checked: getProp('checked') as boolean | undefined,
                    value: getProp('value') as string | undefined,
                }
            })

        return state
    }

    /**
     * 获取 Cookies
     */
    async getCookies(): Promise<Cookie[]> {
        this.ensureSession()
        const {cookies} = (await this.send('Network.getCookies')) as {
            cookies: Cookie[];
        }
        return cookies
    }

    /**
     * 设置 Cookie
     */
    async setCookie(
        name: string,
        value: string,
        options: CookieOptions = {},
    ): Promise<void> {
        this.ensureSession()

        // 获取当前 URL
        const url = this.state?.url ?? 'http://localhost'

        await this.send('Network.setCookie', {
            name,
            value,
            url,
            ...options,
        })
    }

    /**
     * 删除 Cookie
     */
    async deleteCookie(name: string): Promise<void> {
        this.ensureSession()
        const url = this.state?.url ?? 'http://localhost'
        await this.send('Network.deleteCookies', {name, url})
    }

    /**
     * 清除所有 Cookies
     */
    async clearCookies(): Promise<void> {
        this.ensureSession()
        await this.send('Network.clearBrowserCookies')
    }

    /**
     * 获取控制台日志
     */
    getConsoleLogs(level?: string, limit = 100): ConsoleLogEntry[] {
        let logs = this.consoleLogs
        if (level && level !== 'all') {
            logs = logs.filter((l) => l.level === level)
        }
        return logs.slice(-limit)
    }

    /**
     * 获取网络请求日志
     */
    getNetworkRequests(urlPattern?: string, limit = 100): NetworkRequestEntry[] {
        let requests = this.networkRequests
        if (urlPattern) {
            const regex = new RegExp(urlPattern.replace(/\*/g, '.*'))
            requests    = requests.filter((r) => regex.test(r.url))
        }
        return requests.slice(-limit)
    }

    /**
     * 清除日志
     */
    clearLogs(): void {
        this.consoleLogs     = []
        this.networkRequests = []
        this.requestMap.clear()
    }

    /**
     * 执行 JavaScript
     */
    async evaluate<T>(script: string, args?: unknown[], timeout?: number): Promise<T> {
        this.ensureSession()

        let expression = script
        if (args && args.length > 0) {
            // 将参数序列化并注入
            const argsStr = args.map((a) => JSON.stringify(a)).join(', ')
            expression    = `(${script})(${argsStr})`
        }

        const {result, exceptionDetails} = (await this.send('Runtime.evaluate', {
            expression,
            returnByValue: true,
            awaitPromise: true,
        }, timeout)) as {
            result: { value: T };
            exceptionDetails?: { exception: { description: string } };
        }

        if (exceptionDetails) {
            throw new Error(exceptionDetails.exception.description)
        }

        return result.value
    }

    /**
     * 设置视口
     */
    async setViewport(width: number, height: number): Promise<void> {
        this.ensureSession()
        await this.send('Emulation.setDeviceMetricsOverride', {
            width,
            height,
            deviceScaleFactor: 1,
            mobile: false,
        })
    }

    /**
     * 设置 User-Agent
     */
    async setUserAgent(userAgent: string): Promise<void> {
        this.ensureSession()
        await this.send('Emulation.setUserAgentOverride', {userAgent})
    }

    /**
     * 清除缓存
     */
    async clearCache(type: 'all' | 'cookies' | 'storage' | 'cache' = 'all'): Promise<void> {
        this.ensureSession()

        if (type === 'all' || type === 'cookies') {
            await this.send('Network.clearBrowserCookies')
        }
        if (type === 'all' || type === 'cache') {
            await this.send('Network.clearBrowserCache')
        }
        if (type === 'all' || type === 'storage') {
            await this.send('Runtime.evaluate', {
                expression: `
          localStorage.clear();
          sessionStorage.clear();
        `,
            })
        }
    }

    /**
     * 新建页面
     */
    async newPage(): Promise<TargetInfo> {
        this.ensureConnected()

        const {targetId} = (await this.cdp!.send('Target.createTarget', {
            url: 'about:blank',
        })) as { targetId: string }

        await this.attachToTarget(targetId)

        return {
            targetId,
            type: 'page',
            url: 'about:blank',
            title: '',
        }
    }

    /**
     * 关闭页面
     */
    async closePage(targetId?: string): Promise<void> {
        this.ensureConnected()

        const id = targetId ?? this.currentTargetId
        if (!id) {
            throw new TargetNotFoundError('unknown')
        }

        await this.cdp!.send('Target.closeTarget', {targetId: id})

        // 如果关闭的是当前页面，清除会话状态
        if (id === this.currentTargetId) {
            this.sessionId       = null
            this.currentTargetId = null
            this.state           = null
        }
    }

    /**
     * 关闭浏览器
     */
    async close(): Promise<void> {
        // 清除日志
        this.clearLogs()

        // 关闭 CDP 连接
        if (this.cdp) {
            this.cdp.close()
            this.cdp = null
        }

        // 关闭浏览器进程
        if (this.launcher) {
            this.launcher.close()
            this.launcher = null
        }

        this.sessionId          = null
        this.currentTargetId    = null
        this.state              = null
        this.listenersInstalled = false
    }

    /**
     * 获取当前状态
     */
    getState(): SessionState | null {
        return this.state
    }

    /**
     * 是否已连接
     */
    isConnected(): boolean {
        return this.cdp !== null && this.cdp.isConnected
    }

    /**
     * 是否有活跃会话
     */
    hasSession(): boolean {
        return this.sessionId !== null
    }

    /**
     * 串行执行操作（防止并发竞态）
     */
    private async withLock<T>(fn: () => Promise<T>): Promise<T> {
        const previousLock = this.operationLock
        let releaseLock: () => void
        this.operationLock = new Promise<void>((resolve) => {
            releaseLock = resolve
        })
        try {
            await previousLock
            return await fn()
        } finally {
            releaseLock!()
        }
    }

    /**
     * 初始化会话
     */
    private async initSession(): Promise<void> {
        // 启用必要的域
        await Promise.all([
                              this.send('Page.enable'),
                              this.send('DOM.enable'),
                              this.send('Runtime.enable'),
                              this.send('Network.enable'),
                              this.send('Log.enable'),
                          ])

        // 根据 stealth 模式注入反检测脚本
        if (this.stealthMode !== 'off') {
            const script = getAntiDetectionScript(this.stealthMode)
            await this.send('Page.addScriptToEvaluateOnNewDocument', {
                source: script,
            })
            // 对当前页面立即执行反检测脚本
            await this.send('Runtime.evaluate', {
                expression: script,
            })
        }

        // 监听事件
        this.setupEventListeners()

        // 更新状态
        await this.updateState()
    }

    /**
     * 设置事件监听（幂等，只安装一次）
     */
    private setupEventListeners(): void {
        if (this.listenersInstalled) {
            return
        }
        this.listenersInstalled = true

        // 控制台日志
        this.cdp!.onEvent('Runtime.consoleAPICalled', (params: unknown) => {
            const p = params as {
                type: string;
                args: Array<{ value?: unknown; description?: string }>;
                timestamp: number;
                stackTrace?: { callFrames: Array<{ url: string; lineNumber: number }> };
            }
            this.consoleLogs.push({
                                      level: p.type,
                                      text: p.args.map((a) => a.value ?? a.description ?? '').join(' '),
                                      timestamp: p.timestamp,
                                      url: p.stackTrace?.callFrames[0]?.url,
                                      lineNumber: p.stackTrace?.callFrames[0]?.lineNumber,
                                  })
            // 环形缓冲区：超出上限时移除最旧的条目
            if (this.consoleLogs.length > SessionManager.MAX_LOG_ENTRIES) {
                this.consoleLogs.shift()
            }
        })

        // 网络请求
        this.cdp!.onEvent('Network.requestWillBeSent', (params: unknown) => {
            const p = params as {
                requestId: string;
                request: { url: string; method: string };
                type: string;
                timestamp: number;
            }
            this.requestMap.set(p.requestId, {
                url: p.request.url,
                method: p.request.method,
                type: p.type,
                timestamp: p.timestamp,
            })
        })

        this.cdp!.onEvent('Network.responseReceived', (params: unknown) => {
            const p       = params as {
                requestId: string;
                response: { status: number };
                timestamp: number;
            }
            const request = this.requestMap.get(p.requestId)
            if (request) {
                this.networkRequests.push({
                                              ...request,
                                              status: p.response.status,
                                              duration: (p.timestamp - request.timestamp) * 1000,
                                          })
                // 环形缓冲区：超出上限时移除最旧的条目
                if (this.networkRequests.length > SessionManager.MAX_LOG_ENTRIES) {
                    this.networkRequests.shift()
                }
                this.requestMap.delete(p.requestId)
            }
        })

        // 网络请求失败时清理 requestMap，防止泄漏
        this.cdp!.onEvent('Network.loadingFailed', (params: unknown) => {
            const p = params as { requestId: string }
            this.requestMap.delete(p.requestId)
        })
    }

    /**
     * 更新页面状态
     */
    private async updateState(): Promise<void> {
        const result = (await this.send('Runtime.evaluate', {
            expression: 'JSON.stringify({ url: location.href, title: document.title })',
            returnByValue: true,
        })) as { result: { value: string } }

        const {url, title} = JSON.parse(result.result.value)
        this.state         = {
            url,
            title,
            targetId: this.currentTargetId!,
        }
    }

    /**
     * 发送 CDP 命令
     */
    private send<T>(method: string, params?: object, timeout?: number): Promise<T> {
        return this.cdp!.send(method, params, this.sessionId ?? undefined, timeout)
    }

    /**
     * 确保已连接
     */
    private ensureConnected(): void {
        if (!this.cdp || !this.cdp.isConnected) {
            throw new SessionNotFoundError()
        }
    }

    /**
     * 确保有活跃会话
     */
    private ensureSession(): void {
        this.ensureConnected()
        if (!this.sessionId) {
            throw new SessionNotFoundError()
        }
    }
}

/**
 * 获取按键定义
 */
function getKeyDefinition(key: string): {
    key: string;
    code: string;
    keyCode: number;
    text?: string;
} {
    const definitions: Record<
        string,
        { key: string; code: string; keyCode: number; text?: string }
    > = {
        // 修饰键
        Control: {key: 'Control', code: 'ControlLeft', keyCode: 17},
        Shift: {key: 'Shift', code: 'ShiftLeft', keyCode: 16},
        Alt: {key: 'Alt', code: 'AltLeft', keyCode: 18},
        Meta: {key: 'Meta', code: 'MetaLeft', keyCode: 91},
        // 功能键
        Enter: {key: 'Enter', code: 'Enter', keyCode: 13, text: '\r'},
        Tab: {key: 'Tab', code: 'Tab', keyCode: 9},
        Backspace: {key: 'Backspace', code: 'Backspace', keyCode: 8},
        Delete: {key: 'Delete', code: 'Delete', keyCode: 46},
        Escape: {key: 'Escape', code: 'Escape', keyCode: 27},
        Space: {key: ' ', code: 'Space', keyCode: 32, text: ' '},
        // 方向键
        ArrowUp: {key: 'ArrowUp', code: 'ArrowUp', keyCode: 38},
        ArrowDown: {key: 'ArrowDown', code: 'ArrowDown', keyCode: 40},
        ArrowLeft: {key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37},
        ArrowRight: {key: 'ArrowRight', code: 'ArrowRight', keyCode: 39},
        // 其他常用键
        Home: {key: 'Home', code: 'Home', keyCode: 36},
        End: {key: 'End', code: 'End', keyCode: 35},
        PageUp: {key: 'PageUp', code: 'PageUp', keyCode: 33},
        PageDown: {key: 'PageDown', code: 'PageDown', keyCode: 34},
    }

    // 如果是已知按键，返回定义
    if (definitions[key]) {
        return definitions[key]
    }

    // 如果是单个字符，生成定义
    if (key.length === 1) {
        const charCode = key.charCodeAt(0)
        const code     =
                  key >= 'a' && key <= 'z'
                  ? `Key${key.toUpperCase()}`
                  : key >= 'A' && key <= 'Z'
                    ? `Key${key}`
                    : key >= '0' && key <= '9'
                      ? `Digit${key}`
                      : `Key${key}`

        return {
            key,
            code,
            keyCode: charCode,
            text: key,
        }
    }

    // 未知按键
    return {key, code: key, keyCode: 0}
}

/**
 * 获取会话管理器实例
 */
export function getSession(): SessionManager {
    return SessionManager.getInstance()
}
