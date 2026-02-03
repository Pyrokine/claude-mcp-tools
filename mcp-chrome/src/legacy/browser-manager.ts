import puppeteer, {CDPSession, KeyInput, Page} from 'puppeteer-core'
import type {
    BrowserConnectOptions,
    BrowserSession,
    ClickOptions,
    ConsoleMessage,
    DragOptions,
    ElementSummary,
    NetworkRequest,
    PageInfo,
    PageState,
    PixelColor,
    ScreenshotOptions,
    ScrollOptions,
    TypeOptions,
    WaitOptions,
} from './types.js'

/**
 * 浏览器会话管理器
 * 管理多个浏览器连接和页面操作
 */
export class BrowserManager {
    private sessions: Map<string, BrowserSession>      = new Map()
    private pageCache: Map<string, Page>               = new Map()
    private cdpSessions: Map<string, CDPSession>       = new Map()
    private networkLogs: Map<string, NetworkRequest[]> = new Map()
    private consoleLogs: Map<string, ConsoleMessage[]> = new Map()
    private sessionCounter                             = 0

    /**
     * 连接到浏览器
     */
    async connect(options: BrowserConnectOptions = {}): Promise<BrowserSession> {
        const {
                  port  = 9222,
                  host  = 'localhost',
                  alias = `browser_${++this.sessionCounter}`,
              } = options

        if (this.sessions.has(alias)) {
            throw new Error(`Session with alias "${alias}" already exists`)
        }

        const browserURL = `http://${host}:${port}`

        try {
            const browser = await puppeteer.connect({
                                                        browserURL,
                                                        defaultViewport: options.viewportWidth && options.viewportHeight
                                                                         ?
                                                            {
                                                                width: options.viewportWidth,
                                                                height: options.viewportHeight,
                                                            }
                                                                         :
                                                                         null,
                                                    })

            const session: BrowserSession = {
                alias,
                browser,
                host,
                port,
                connectedAt: new Date(),
                wsEndpoint: browser.wsEndpoint(),
            }

            this.sessions.set(alias, session)

            // 监听浏览器断开
            browser.on('disconnected', () => {
                this.sessions.delete(alias)
                this.cleanupSession(alias)
            })

            return session
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            if (message.includes('ECONNREFUSED')) {
                throw new Error(
                    `Failed to connect to browser at ${browserURL}. ` +
                    `Please start Chrome with: google-chrome --remote-debugging-port=${port}`,
                )
            }
            throw error
        }
    }

    /**
     * 断开浏览器连接
     */
    async disconnect(alias: string): Promise<void> {
        const session = this.sessions.get(alias)
        if (!session) {
            throw new Error(`Session "${alias}" not found`)
        }

        await session.browser.disconnect()
        this.sessions.delete(alias)
        this.cleanupSession(alias)
    }

    /**
     * 列出所有会话
     */
    listSessions(): Array<{
        alias: string;
        host: string;
        port: number;
        connectedAt: Date;
        pageCount: number;
    }> {
        return Array.from(this.sessions.values()).map(async (session) => ({
            alias: session.alias,
            host: session.host,
            port: session.port,
            connectedAt: session.connectedAt,
            pageCount: (await session.browser.pages()).length,
        })) as any
    }

    /**
     * 获取会话
     */
    getSession(alias: string): BrowserSession {
        const session = this.sessions.get(alias)
        if (!session) {
            throw new Error(`Session "${alias}" not found`)
        }
        return session
    }

    /**
     * 获取所有页面
     */
    async getPages(alias: string): Promise<PageInfo[]> {
        const session = this.getSession(alias)
        const pages   = await session.browser.pages()

        return Promise.all(pages.map(async (page, index) => {
            const pageId = `${alias}_page_${index}`
            this.pageCache.set(pageId, page)

            return {
                pageId,
                url: page.url(),
                title: await page.title(),
                active: index === pages.length - 1,
            }
        }))
    }

    /**
     * 获取或创建页面
     */
    async getPage(alias: string, pageId?: string): Promise<Page> {
        const session = this.getSession(alias)

        if (pageId && this.pageCache.has(pageId)) {
            const page = this.pageCache.get(pageId)!
            // 检查页面是否仍然有效
            try {
                await page.title()
                return page
            } catch {
                this.pageCache.delete(pageId)
            }
        }

        // 返回最后一个页面或创建新页面
        const pages = await session.browser.pages()
        if (pages.length > 0) {
            const page      = pages[pages.length - 1]
            const newPageId = `${alias}_page_${pages.length - 1}`
            this.pageCache.set(newPageId, page)
            return page
        }

        return this.newPage(alias)
    }

    /**
     * 创建新页面
     */
    async newPage(alias: string): Promise<Page> {
        const session = this.getSession(alias)
        const page    = await session.browser.newPage()
        const pages   = await session.browser.pages()
        const pageId  = `${alias}_page_${pages.length - 1}`
        this.pageCache.set(pageId, page)

        // 设置页面监听
        this.setupPageListeners(pageId, page)

        return page
    }

    /**
     * 关闭页面
     */
    async closePage(alias: string, pageId: string): Promise<void> {
        const page = this.pageCache.get(pageId)
        if (page) {
            await page.close()
            this.pageCache.delete(pageId)
            this.networkLogs.delete(pageId)
            this.consoleLogs.delete(pageId)
        }
    }

    /**
     * 导航到 URL
     */
    async navigate(
        alias: string,
        url: string,
        options: WaitOptions = {},
    ): Promise<{ url: string; title: string }> {
        const page                                              = await this.getPage(alias)
        const {timeout = 30000, waitUntil = 'domcontentloaded'} = options

        await page.goto(url, {timeout, waitUntil})

        return {
            url: page.url(),
            title: await page.title(),
        }
    }

    /**
     * 后退
     */
    async goBack(alias: string): Promise<{ url: string; title: string } | null> {
        const page     = await this.getPage(alias)
        const response = await page.goBack()
        if (!response) {
            return null
        }

        return {
            url: page.url(),
            title: await page.title(),
        }
    }

    /**
     * 前进
     */
    async goForward(alias: string): Promise<{ url: string; title: string } | null> {
        const page     = await this.getPage(alias)
        const response = await page.goForward()
        if (!response) {
            return null
        }

        return {
            url: page.url(),
            title: await page.title(),
        }
    }

    /**
     * 刷新
     */
    async refresh(alias: string): Promise<{ url: string; title: string }> {
        const page = await this.getPage(alias)
        await page.reload()

        return {
            url: page.url(),
            title: await page.title(),
        }
    }

    /**
     * 获取页面状态
     */
    async getPageState(alias: string, maxElements = 50): Promise<PageState> {
        const page = await this.getPage(alias)

        const state = await page.evaluate((max: number) => {
            const interactableSelectors = [
                'a[href]',
                'button',
                'input',
                'select',
                'textarea',
                '[onclick]',
                '[role="button"]',
                '[role="link"]',
                '[role="checkbox"]',
                '[role="radio"]',
                '[role="tab"]',
                '[role="menuitem"]',
                '[tabindex]',
                '[contenteditable="true"]',
            ]

            const elements                           = document.querySelectorAll(interactableSelectors.join(','))
            const elementSummaries: ElementSummary[] = []

            for (let i = 0; i < Math.min(elements.length, max); i++) {
                const el        = elements[i] as HTMLElement
                const rect      = el.getBoundingClientRect()
                const isVisible = rect.width > 0 && rect.height > 0 &&
                                  window.getComputedStyle(el).visibility !== 'hidden' &&
                                  window.getComputedStyle(el).display !== 'none'

                // 生成选择器
                let selector = ''
                if (el.id) {
                    selector = `#${el.id}`
                } else if (el.className && typeof el.className === 'string') {
                    const classes = el.className.trim().split(/\s+/).slice(0, 2).join('.')
                    if (classes) {
                        selector = `${el.tagName.toLowerCase()}.${classes}`
                    }
                }
                if (!selector) {
                    selector     = el.tagName.toLowerCase()
                    const parent = el.parentElement
                    if (parent) {
                        const siblings = Array.from(parent.children).filter(
                            (c) => c.tagName === el.tagName,
                        )
                        if (siblings.length > 1) {
                            const index = siblings.indexOf(el) + 1
                            selector += `:nth-of-type(${index})`
                        }
                    }
                }

                elementSummaries.push({
                                          index: i,
                                          tag: el.tagName.toLowerCase(),
                                          text: (el.textContent ||
                                                 el.getAttribute('placeholder') ||
                                                 el.getAttribute('aria-label') ||
                                                 '').slice(0, 80).trim(),
                                          selector,
                                          role: el.getAttribute('role') || undefined,
                                          type: el.getAttribute('type') || undefined,
                                          visible: isVisible,
                                          bounds: isVisible ? {
                                              x: Math.round(rect.x),
                                              y: Math.round(rect.y),
                                              width: Math.round(rect.width),
                                              height: Math.round(rect.height),
                                          } : undefined,
                                      })
            }

            return {
                url: location.href,
                title: document.title,
                viewport: {
                    width: window.innerWidth,
                    height: window.innerHeight,
                },
                scroll: {
                    x: window.scrollX,
                    y: window.scrollY,
                },
                elements: elementSummaries,
                formCount: document.forms.length,
                linkCount: document.links.length,
            }
        }, maxElements)

        return state
    }

    /**
     * 点击元素
     */
    async click(
        alias: string,
        target: string | { x: number; y: number },
        options: ClickOptions = {},
    ): Promise<void> {
        const page                                                         = await this.getPage(alias)
        const {button = 'left', clickCount = 1, delay = 0, modifiers = []} = options

        if (typeof target === 'string') {
            // 选择器点击
            await page.click(target, {
                button,
                clickCount,
                delay,
            })
        } else {
            // 坐标点击
            const cdp = await this.getCDPSession(alias, page)

            // 按下修饰键
            for (const mod of modifiers) {
                await cdp.send('Input.dispatchKeyEvent', {
                    type: 'keyDown',
                    key: mod,
                    modifiers: this.getModifierBit(modifiers),
                })
            }

            await cdp.send('Input.dispatchMouseEvent', {
                type: 'mousePressed',
                x: target.x,
                y: target.y,
                button,
                clickCount,
                modifiers: this.getModifierBit(modifiers),
            })

            if (delay > 0) {
                await new Promise((resolve) => setTimeout(resolve, delay))
            }

            await cdp.send('Input.dispatchMouseEvent', {
                type: 'mouseReleased',
                x: target.x,
                y: target.y,
                button,
                clickCount,
                modifiers: this.getModifierBit(modifiers),
            })

            // 释放修饰键
            for (const mod of modifiers) {
                await cdp.send('Input.dispatchKeyEvent', {
                    type: 'keyUp',
                    key: mod,
                })
            }
        }
    }

    /**
     * 双击
     */
    async doubleClick(
        alias: string,
        target: string | { x: number; y: number },
    ): Promise<void> {
        await this.click(alias, target, {clickCount: 2})
    }

    /**
     * 右键点击
     */
    async rightClick(
        alias: string,
        target: string | { x: number; y: number },
    ): Promise<void> {
        await this.click(alias, target, {button: 'right'})
    }

    /**
     * 悬停
     */
    async hover(
        alias: string,
        target: string | { x: number; y: number },
    ): Promise<void> {
        const page = await this.getPage(alias)

        if (typeof target === 'string') {
            await page.hover(target)
        } else {
            const cdp = await this.getCDPSession(alias, page)
            await cdp.send('Input.dispatchMouseEvent', {
                type: 'mouseMoved',
                x: target.x,
                y: target.y,
            })
        }
    }

    /**
     * 拖拽
     */
    async drag(alias: string, options: DragOptions): Promise<void> {
        const page                                                     = await this.getPage(alias)
        const cdp                                                      = await this.getCDPSession(alias, page)
        const {startX, startY, endX, endY, duration = 500, steps = 10} = options

        // 移动到起始位置
        await cdp.send('Input.dispatchMouseEvent', {
            type: 'mouseMoved',
            x: startX,
            y: startY,
        })

        // 按下鼠标
        await cdp.send('Input.dispatchMouseEvent', {
            type: 'mousePressed',
            x: startX,
            y: startY,
            button: 'left',
            clickCount: 1,
        })

        // 逐步移动
        const stepDelay = duration / steps
        for (let i = 1; i <= steps; i++) {
            const progress = i / steps
            const x        = startX + (endX - startX) * progress
            const y        = startY + (endY - startY) * progress

            await cdp.send('Input.dispatchMouseEvent', {
                type: 'mouseMoved',
                x,
                y,
            })

            await new Promise((resolve) => setTimeout(resolve, stepDelay))
        }

        // 释放鼠标
        await cdp.send('Input.dispatchMouseEvent', {
            type: 'mouseReleased',
            x: endX,
            y: endY,
            button: 'left',
            clickCount: 1,
        })
    }

    /**
     * 长按
     */
    async longPress(
        alias: string,
        target: string | { x: number; y: number },
        duration = 1000,
    ): Promise<void> {
        await this.click(alias, target, {delay: duration})
    }

    /**
     * 输入文本
     */
    async type(
        alias: string,
        selector: string,
        text: string,
        options: TypeOptions = {},
    ): Promise<void> {
        const page                       = await this.getPage(alias)
        const {delay = 0, clear = false} = options

        if (clear) {
            await page.click(selector, {clickCount: 3})
            await page.keyboard.press('Backspace')
        }

        await page.type(selector, text, {delay})
    }

    /**
     * 按键
     */
    async press(alias: string, key: string, modifiers?: string[]): Promise<void> {
        const page = await this.getPage(alias)

        if (modifiers && modifiers.length > 0) {
            for (const mod of modifiers) {
                await page.keyboard.down(mod as KeyInput)
            }
        }

        await page.keyboard.press(key as KeyInput)

        if (modifiers && modifiers.length > 0) {
            for (const mod of modifiers.reverse()) {
                await page.keyboard.up(mod as KeyInput)
            }
        }
    }

    /**
     * 滚动
     */
    async scroll(alias: string, options: ScrollOptions = {}): Promise<void> {
        const page                                             = await this.getPage(alias)
        const {direction, distance = 300, x, y, smooth = true} = options

        if (x !== undefined || y !== undefined) {
            // 滚动到指定位置
            await page.evaluate(
                ({x, y, smooth}) => {
                    window.scrollTo({
                                        left: x,
                                        top: y,
                                        behavior: smooth ? 'smooth' : 'auto',
                                    })
                },
                {x: x ?? window.scrollX, y: y ?? window.scrollY, smooth},
            )
        } else if (direction) {
            // 方向滚动
            const scrollMap: Record<string, { x: number; y: number }> = {
                up: {x: 0, y: -distance},
                down: {x: 0, y: distance},
                left: {x: -distance, y: 0},
                right: {x: distance, y: 0},
            }
            const delta                                               = scrollMap[direction]

            await page.evaluate(
                ({dx, dy, smooth}) => {
                    window.scrollBy({
                                        left: dx,
                                        top: dy,
                                        behavior: smooth ? 'smooth' : 'auto',
                                    })
                },
                {dx: delta.x, dy: delta.y, smooth},
            )
        }
    }

    /**
     * 滚动元素到可见
     */
    async scrollIntoView(alias: string, selector: string): Promise<void> {
        const page = await this.getPage(alias)
        await page.evaluate((sel) => {
            const element = document.querySelector(sel)
            if (element) {
                element.scrollIntoView({behavior: 'smooth', block: 'center'})
            }
        }, selector)
    }

    /**
     * 截图
     */
    async screenshot(
        alias: string,
        options: ScreenshotOptions = {},
    ): Promise<string> {
        const page = await this.getPage(alias)
        const {
                  fullPage       = false,
                  format         = 'png',
                  quality,
                  clip,
                  omitBackground = false,
              }    = options

        const buffer = await page.screenshot({
                                                 fullPage,
                                                 type: format,
                                                 quality: format === 'png' ? undefined : quality,
                                                 clip,
                                                 omitBackground,
                                                 encoding: 'base64',
                                             })

        return buffer as string
    }

    /**
     * 获取指定坐标的像素颜色
     */
    async getPixelColor(alias: string, x: number, y: number): Promise<PixelColor> {
        const page = await this.getPage(alias)

        // 截取 1x1 的图片
        const base64 = await page.screenshot({
                                                 clip: {x, y, width: 1, height: 1},
                                                 encoding: 'base64',
                                                 type: 'png',
                                             }) as string

        // 解析 PNG 像素（简化实现，实际需要解码 PNG）
        // 这里使用 canvas 在页面中解析
        const color = await page.evaluate(
            async ({base64, x, y}) => {
                const img = new Image()
                img.src   = `data:image/png;base64,${base64}`
                await new Promise((resolve) => (img.onload = resolve))

                const canvas  = document.createElement('canvas')
                canvas.width  = 1
                canvas.height = 1
                const ctx     = canvas.getContext('2d')!
                ctx.drawImage(img, 0, 0)

                const pixel = ctx.getImageData(0, 0, 1, 1).data
                return {
                    r: pixel[0],
                    g: pixel[1],
                    b: pixel[2],
                    a: pixel[3],
                }
            },
            {base64, x, y},
        )

        const hex = `#${color.r.toString(16).padStart(2, '0')}${color.g.toString(16).padStart(
            2,
            '0',
        )}${color.b.toString(16).padStart(2, '0')}`

        return {...color, hex}
    }

    /**
     * 提取文本
     */
    async extractText(alias: string, selector?: string): Promise<string> {
        const page = await this.getPage(alias)

        if (selector) {
            return page.evaluate((sel) => {
                const el = document.querySelector(sel)
                return el ? (el as HTMLElement).innerText : ''
            }, selector)
        }

        return page.evaluate(() => document.body.innerText)
    }

    /**
     * 提取 HTML
     */
    async extractHtml(alias: string, selector?: string): Promise<string> {
        const page = await this.getPage(alias)

        if (selector) {
            return page.evaluate((sel) => {
                const el = document.querySelector(sel)
                return el ? el.outerHTML : ''
            }, selector)
        }

        return page.evaluate(() => document.documentElement.outerHTML)
    }

    /**
     * 提取属性
     */
    async extractAttribute(
        alias: string,
        selector: string,
        attribute: string,
    ): Promise<string | null> {
        const page = await this.getPage(alias)
        return page.evaluate(
            ({sel, attr}) => {
                const el = document.querySelector(sel)
                return el ? el.getAttribute(attr) : null
            },
            {sel: selector, attr: attribute},
        )
    }

    /**
     * 执行 JavaScript
     */
    async evaluate<T>(alias: string, script: string): Promise<T> {
        const page = await this.getPage(alias)
        return page.evaluate(script) as Promise<T>
    }

    /**
     * 等待元素
     */
    async waitForSelector(
        alias: string,
        selector: string,
        options: { visible?: boolean; hidden?: boolean; timeout?: number } = {},
    ): Promise<boolean> {
        const page                               = await this.getPage(alias)
        const {timeout = 30000, visible, hidden} = options

        try {
            await page.waitForSelector(selector, {timeout, visible, hidden})
            return true
        } catch {
            return false
        }
    }

    /**
     * 等待导航完成
     */
    async waitForNavigation(
        alias: string,
        options: WaitOptions = {},
    ): Promise<void> {
        const page                                              = await this.getPage(alias)
        const {timeout = 30000, waitUntil = 'domcontentloaded'} = options
        await page.waitForNavigation({timeout, waitUntil})
    }

    /**
     * 等待指定时间
     */
    async wait(ms: number): Promise<void> {
        await new Promise((resolve) => setTimeout(resolve, ms))
    }

    /**
     * 获取网络日志
     */
    getNetworkLogs(alias: string, pageId?: string): NetworkRequest[] {
        const key = pageId || alias
        return this.networkLogs.get(key) || []
    }

    /**
     * 获取控制台日志
     */
    getConsoleLogs(alias: string, pageId?: string): ConsoleMessage[] {
        const key = pageId || alias
        return this.consoleLogs.get(key) || []
    }

    /**
     * 清除日志
     */
    clearLogs(alias: string, pageId?: string): void {
        const key = pageId || alias
        this.networkLogs.delete(key)
        this.consoleLogs.delete(key)
    }

    /**
     * 设置视口大小
     */
    async setViewport(
        alias: string,
        width: number,
        height: number,
    ): Promise<void> {
        const page = await this.getPage(alias)
        await page.setViewport({width, height})
    }

    /**
     * 设置 User-Agent
     */
    async setUserAgent(alias: string, userAgent: string): Promise<void> {
        const page = await this.getPage(alias)
        await page.setUserAgent(userAgent)
    }

    /**
     * 设置额外 HTTP 头
     */
    async setExtraHeaders(
        alias: string,
        headers: Record<string, string>,
    ): Promise<void> {
        const page = await this.getPage(alias)
        await page.setExtraHTTPHeaders(headers)
    }

    /**
     * 模拟设备
     */
    async emulateDevice(alias: string, device: string): Promise<void> {
        const page             = await this.getPage(alias)
        const devices          = puppeteer.KnownDevices
        const deviceDescriptor = devices[device as keyof typeof devices]

        if (!deviceDescriptor) {
            throw new Error(`Unknown device: ${device}. Available: ${Object.keys(devices).join(', ')}`)
        }

        await page.emulate(deviceDescriptor)
    }

    /**
     * 获取 CDP Session
     */
    private async getCDPSession(alias: string, page: Page): Promise<CDPSession> {
        const key = `${alias}_${page.url()}`
        if (!this.cdpSessions.has(key)) {
            const session = await page.createCDPSession()
            this.cdpSessions.set(key, session)
        }
        return this.cdpSessions.get(key)!
    }

    /**
     * 设置页面监听器
     */
    private setupPageListeners(pageId: string, page: Page): void {
        // 初始化日志数组
        this.networkLogs.set(pageId, [])
        this.consoleLogs.set(pageId, [])

        // 监听网络请求
        page.on('request', (request) => {
            const logs = this.networkLogs.get(pageId) || []
            logs.push({
                          url: request.url(),
                          method: request.method(),
                          type: request.resourceType(),
                          timestamp: Date.now(),
                      })
            // 保持最多 100 条记录
            if (logs.length > 100) {
                logs.shift()
            }
            this.networkLogs.set(pageId, logs)
        })

        page.on('response', (response) => {
            const logs = this.networkLogs.get(pageId) || []
            const log  = logs.find((l) => l.url === response.url() && !l.status)
            if (log) {
                log.status = response.status()
            }
        })

        // 监听控制台
        page.on('console', (msg) => {
            const logs = this.consoleLogs.get(pageId) || []
            logs.push({
                          type: msg.type() as ConsoleMessage['type'],
                          text: msg.text(),
                          timestamp: Date.now(),
                      })
            if (logs.length > 100) {
                logs.shift()
            }
            this.consoleLogs.set(pageId, logs)
        })
    }

    /**
     * 清理会话资源
     */
    private cleanupSession(alias: string): void {
        // 清理页面缓存
        for (const [key, page] of this.pageCache.entries()) {
            if (key.startsWith(alias)) {
                this.pageCache.delete(key)
            }
        }

        // 清理 CDP Session
        for (const [key, session] of this.cdpSessions.entries()) {
            if (key.startsWith(alias)) {
                session.detach().catch(() => {
                })
                this.cdpSessions.delete(key)
            }
        }

        // 清理日志
        for (const key of this.networkLogs.keys()) {
            if (key.startsWith(alias)) {
                this.networkLogs.delete(key)
            }
        }
        for (const key of this.consoleLogs.keys()) {
            if (key.startsWith(alias)) {
                this.consoleLogs.delete(key)
            }
        }
    }

    /**
     * 获取修饰键位掩码
     */
    private getModifierBit(modifiers: string[]): number {
        let bit = 0
        if (modifiers.includes('Alt')) {
            bit |= 1
        }
        if (modifiers.includes('Control')) {
            bit |= 2
        }
        if (modifiers.includes('Meta')) {
            bit |= 4
        }
        if (modifiers.includes('Shift')) {
            bit |= 8
        }
        return bit
    }
}

// 单例导出
export const browserManager = new BrowserManager()
