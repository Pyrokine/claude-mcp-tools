/**
 * input 工具
 *
 * 键鼠输入：键盘、鼠标及任意组合（事件序列）
 *
 * 设计原则：
 * - 事件序列模型：所有键鼠操作本质是事件序列
 * - 支持任意组合：Ctrl+Alt+A+左键+右键+拖拽
 * - humanize 可选：行为模拟是可选功能
 */

import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js'
import {z} from 'zod'
import {generateBezierPath, getMouseMoveDelay, getTypingDelay, randomDelay} from '../anti-detection/index.js'
import {formatErrorResponse, formatResponse, getSession, getUnifiedSession} from '../core/index.js'
import type {InputEvent, Target} from '../core/types.js'
import {targetToFindParams, targetZodSchema} from './schema.js'

/**
 * InputEvent schema
 */
const inputEventSchema = z.object({
                                      type: z.enum([
                                                       'keydown', 'keyup', 'mousedown', 'mouseup', 'mousemove',
                                                       'wheel', 'touchstart', 'touchmove', 'touchend', 'type', 'wait',
                                                   ]).describe('事件类型'),
                                      key: z.string().optional().describe('按键（keydown/keyup）'),
                                      button: z.enum(['left', 'middle', 'right', 'back', 'forward'])
                                               .optional()
                                               .describe('鼠标按钮'),
                                      target: targetZodSchema.optional().describe(
                                          '目标元素（mousemove/touchstart/touchmove 必填；mousedown/wheel/type 可选，用于先定位再操作）'),
                                      steps: z.number().optional().describe('移动步数（mousemove/touchmove）'),
                                      deltaX: z.number().optional().describe('水平滚动量'),
                                      deltaY: z.number().optional().describe('垂直滚动量'),
                                      text: z.string().optional().describe('输入文本'),
                                      delay: z.number().optional().describe('按键间隔毫秒'),
                                      ms: z.number().optional().describe('等待毫秒'),
                                  })

/**
 * input 参数 schema
 */
const inputSchema = z.object({
                                 events: z.array(inputEventSchema).describe('事件序列'),
                                 humanize: z.boolean().optional().describe('启用人类行为模拟（贝塞尔曲线移动、随机延迟）'),
                                 tabId: z.string().optional().describe(
                                     '目标 Tab ID（可选，仅 Extension 模式）。不指定则使用当前 attach 的 tab。可操作非当前 attach 的 tab。CDP 模式下忽略此参数'),
                                 timeout: z.number().optional().describe('超时毫秒'),
                                 frame: z.union([z.string(), z.number()]).optional().describe(
                                     'iframe 定位（可选，仅 Extension 模式）。CSS 选择器（如 "iframe#main"）或索引（如 0）。不指定则在主框架操作'),
                             })

/**
 * input 工具处理器
 */
async function handleInput(args: z.infer<typeof inputSchema>): Promise<{
    content: Array<{ type: 'text'; text: string }>;
    isError?: boolean;
}> {
    try {
        const unifiedSession = getUnifiedSession()
        const mode           = unifiedSession.getMode()
        const humanize       = args.humanize ?? false

        return await unifiedSession.withTabId(args.tabId, async () => {
            return await unifiedSession.withFrame(args.frame, async () => {

                // 根据连接模式选择执行方式
                if (mode === 'extension') {
                    // Extension 模式：使用 debugger API
                    for (const event of args.events) {
                        await executeEventExtension(unifiedSession, event as InputEvent, humanize, args.timeout)
                    }
                } else {
                    // CDP 模式：使用原有逻辑
                    const session = getSession()
                    for (const event of args.events) {
                        await executeEvent(session, event as InputEvent, humanize, args.timeout)
                    }
                }

                return formatResponse({
                                          success: true,
                                          eventsExecuted: args.events.length,
                                          mode,
                                      })

            }) // withFrame
        }) // withTabId
    } catch (error) {
        return formatErrorResponse(error)
    }
}

/**
 * Extension 模式：执行单个事件
 */
async function executeEventExtension(
    unifiedSession: ReturnType<typeof getUnifiedSession>,
    event: InputEvent,
    humanize: boolean,
    timeout?: number,
): Promise<void> {
    switch (event.type) {
        case 'keydown': {
            if (!event.key) {
                throw new Error('keydown 事件需要 key 参数')
            }
            await unifiedSession.keyDown(event.key)
            break
        }

        case 'keyup': {
            if (!event.key) {
                throw new Error('keyup 事件需要 key 参数')
            }
            await unifiedSession.keyUp(event.key)
            break
        }

        case 'mousedown': {
            if (event.target) {
                const point = await getTargetPointExtension(unifiedSession, event.target, timeout)
                await unifiedSession.mouseMove(point.x, point.y)
            }
            await unifiedSession.mouseDown(event.button ?? 'left')
            break
        }

        case 'mouseup': {
            await unifiedSession.mouseUp(event.button ?? 'left')
            break
        }

        case 'mousemove': {
            if (!event.target) {
                throw new Error('mousemove 事件需要 target 参数')
            }
            const point = await getTargetPointExtension(unifiedSession, event.target, timeout)

            if (humanize && event.steps && event.steps > 1) {
                const path = generateBezierPath(unifiedSession.getMousePosition(), point, event.steps)
                for (const p of path) {
                    await unifiedSession.mouseMove(p.x, p.y)
                    await randomDelay(getMouseMoveDelay(), getMouseMoveDelay() * 2)
                }
            } else {
                await unifiedSession.mouseMove(point.x, point.y)
            }
            break
        }

        case 'wheel': {
            if (event.target) {
                const point = await getTargetPointExtension(unifiedSession, event.target, timeout)
                await unifiedSession.mouseMove(point.x, point.y)
            }
            await unifiedSession.mouseWheel(event.deltaX ?? 0, event.deltaY ?? 0)
            break
        }

        case 'touchstart': {
            if (!event.target) {
                throw new Error('touchstart 事件需要 target 参数')
            }
            const point = await getTargetPointExtension(unifiedSession, event.target, timeout)
            await unifiedSession.touchStart(point.x, point.y)
            break
        }

        case 'touchmove': {
            if (!event.target) {
                throw new Error('touchmove 事件需要 target 参数')
            }
            const point = await getTargetPointExtension(unifiedSession, event.target, timeout)
            await unifiedSession.touchMove(point.x, point.y)
            break
        }

        case 'touchend': {
            await unifiedSession.touchEnd()
            break
        }

        case 'type': {
            if (!event.text) {
                throw new Error('type 事件需要 text 参数')
            }

            // 如果有 target，先点击目标（聚焦）
            if (event.target) {
                const point = await getTargetPointExtension(unifiedSession, event.target, timeout)
                await unifiedSession.mouseMove(point.x, point.y)
                await unifiedSession.mouseDown('left')
                await unifiedSession.mouseUp('left')
            }

            const delay = event.delay ?? 0
            if (humanize) {
                for (const char of event.text) {
                    await unifiedSession.typeText(char)
                    await randomDelay(getTypingDelay(delay), getTypingDelay(delay) * 1.5)
                }
            } else {
                await unifiedSession.typeText(event.text, delay)
            }
            break
        }

        case 'wait': {
            if (!event.ms) {
                throw new Error('wait 事件需要 ms 参数')
            }
            await new Promise(resolve => setTimeout(resolve, event.ms))
            break
        }

        default:
            throw new Error(`未知事件类型: ${(event as { type: string }).type}`)
    }
}

/**
 * Extension 模式：获取目标点坐标
 */
async function getTargetPointExtension(
    unifiedSession: ReturnType<typeof getUnifiedSession>,
    target: Target,
    timeout?: number,
): Promise<{ x: number; y: number }> {
    // 如果是坐标，直接返回
    if ('x' in target && 'y' in target) {
        return {x: target.x, y: target.y}
    }

    const {selector, text, xpath, nth: nthParam} = targetToFindParams(target as Target & { nth?: number })
    const elements                               = await unifiedSession.find(selector, text, xpath, timeout)
    if (elements.length === 0) {
        throw new Error(`未找到目标元素: ${JSON.stringify(target)}`)
    }

    const nth = nthParam ?? 0
    if (nth >= elements.length) {
        throw new Error(`第 ${nth} 个匹配元素不存在（共 ${elements.length} 个）`)
    }
    const rect = elements[nth].rect
    return {
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
    }
}

/**
 * CDP 模式：执行单个事件
 */
async function executeEvent(
    session: ReturnType<typeof getSession>,
    event: InputEvent,
    humanize: boolean,
    timeout?: number,
): Promise<void> {
    switch (event.type) {
        case 'keydown': {
            if (!event.key) {
                throw new Error('keydown 事件需要 key 参数')
            }
            await session.keyDown(event.key)
            break
        }

        case 'keyup': {
            if (!event.key) {
                throw new Error('keyup 事件需要 key 参数')
            }
            await session.keyUp(event.key)
            break
        }

        case 'mousedown': {
            // 如果有 target，先移动到目标位置
            if (event.target) {
                await moveToTarget(session, event.target, humanize, timeout)
            }
            await session.mouseDown(event.button ?? 'left')
            break
        }

        case 'mouseup': {
            await session.mouseUp(event.button ?? 'left')
            break
        }

        case 'mousemove': {
            if (!event.target) {
                throw new Error('mousemove 事件需要 target 参数')
            }
            await moveToTarget(session, event.target, humanize, timeout, event.steps)
            break
        }

        case 'wheel': {
            // 如果有 target，先移动到目标位置
            if (event.target) {
                await moveToTarget(session, event.target, humanize, timeout)
            }
            await session.mouseWheel(event.deltaX ?? 0, event.deltaY ?? 0)
            break
        }

        case 'touchstart': {
            if (!event.target) {
                throw new Error('touchstart 事件需要 target 参数')
            }
            const point = await getTargetPoint(session, event.target, timeout)
            await session.touchStart(point.x, point.y)
            break
        }

        case 'touchmove': {
            if (!event.target) {
                throw new Error('touchmove 事件需要 target 参数')
            }
            const point = await getTargetPoint(session, event.target, timeout)

            if (humanize && event.steps && event.steps > 1) {
                // 人类化触屏移动
                const current = session.getBehaviorSimulator().getCurrentPosition()
                const path    = generateBezierPath(current, point, event.steps)
                for (const p of path) {
                    await session.touchMove(p.x, p.y)
                    await randomDelay(5, 15)
                }
            } else {
                await session.touchMove(point.x, point.y)
            }
            break
        }

        case 'touchend': {
            await session.touchEnd()
            break
        }

        case 'type': {
            if (!event.text) {
                throw new Error('type 事件需要 text 参数')
            }
            // 如果有 target，先点击目标（聚焦），使用 input 等待类型
            if (event.target) {
                await moveToTarget(session, event.target, humanize, timeout, undefined, 'input')
                await session.mouseDown('left')
                await session.mouseUp('left')
            }

            const delay = event.delay ?? 0
            if (humanize) {
                // 人类化打字
                for (const char of event.text) {
                    await session.type(char)
                    await randomDelay(getTypingDelay(delay), getTypingDelay(delay) * 1.5)
                }
            } else {
                await session.type(event.text, delay)
            }
            break
        }

        case 'wait': {
            if (!event.ms) {
                throw new Error('wait 事件需要 ms 参数')
            }
            await new Promise((resolve) => setTimeout(resolve, event.ms))
            break
        }

        default:
            throw new Error(`未知事件类型: ${(event as { type: string }).type}`)
    }
}

/**
 * 移动到目标位置
 */
async function moveToTarget(
    session: ReturnType<typeof getSession>,
    target: Target,
    humanize: boolean,
    timeout?: number,
    steps?: number,
    waitType: 'click' | 'input' | 'none' = 'click',
): Promise<void> {
    const point     = await getTargetPoint(session, target, timeout, waitType)
    const simulator = session.getBehaviorSimulator()

    if (humanize) {
        // 人类化鼠标移动（贝塞尔曲线）
        const path = generateBezierPath(simulator.getCurrentPosition(), point, steps)
        for (const p of path) {
            await session.mouseMove(p.x, p.y)
            await randomDelay(getMouseMoveDelay(), getMouseMoveDelay() * 2)
        }
    } else if (steps && steps > 1) {
        // 直线移动，分步
        const current = simulator.getCurrentPosition()
        for (let i = 1; i <= steps; i++) {
            const t = i / steps
            const x = current.x + (point.x - current.x) * t
            const y = current.y + (point.y - current.y) * t
            await session.mouseMove(x, y)
        }
    } else {
        // 直接移动
        await session.mouseMove(point.x, point.y)
    }
}

/**
 * 获取目标点坐标（带自动等待）
 */
async function getTargetPoint(
    session: ReturnType<typeof getSession>,
    target: Target,
    timeout?: number,
    waitType: 'click' | 'input' | 'none' = 'click',
): Promise<{ x: number; y: number }> {
    // 如果是坐标，直接返回
    if ('x' in target && 'y' in target) {
        return {x: target.x, y: target.y}
    }

    // 使用 Locator 定位元素
    const locator = session.createLocator(target, {timeout})
    const nodeId  = await locator.find()

    // 根据操作类型执行自动等待
    if (waitType !== 'none') {
        const autoWait = session.createAutoWait({timeout})
        if (waitType === 'click') {
            await autoWait.waitForClickable(nodeId)
        } else if (waitType === 'input') {
            await autoWait.waitForInputReady(nodeId)
        }
    }

    return locator.getClickablePoint()
}

/**
 * 注册 input 工具
 */
export function registerInputTool(server: McpServer): void {
    server.registerTool('input', {
        description: '键鼠输入：键盘、鼠标及任意组合',
        inputSchema: inputSchema,
    }, (args) => handleInput(args))
}
