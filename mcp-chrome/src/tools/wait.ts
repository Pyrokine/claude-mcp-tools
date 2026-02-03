/**
 * wait 工具
 *
 * 等待条件：
 * - element: 等待元素出现/消失/可见/隐藏
 * - navigation: 等待导航完成
 * - time: 固定等待时间
 * - idle: 等待网络空闲
 */

import {z} from 'zod'
import {formatErrorResponse, getSession, TimeoutError} from '../core/index.js'
import type {ElementState, Target} from '../core/types.js'
import {targetJsonSchema, targetZodSchema} from './schema.js'

/**
 * wait 工具定义
 */
export const waitToolDefinition = {
    name: 'wait',
    description: '等待条件：元素、导航、时间',
    inputSchema: {
        type: 'object' as const,
        properties: {
            for: {
                type: 'string',
                enum: ['element', 'navigation', 'time', 'idle'],
                description: '等待类型',
            },
            target: {
                ...targetJsonSchema,
                description: '目标元素（for=element 时必填；navigation/time/idle 不需要）',
            },
            state: {
                type: 'string',
                enum: ['visible', 'hidden', 'attached', 'detached'],
                description: '元素状态（element）',
            },
            ms: {
                type: 'number',
                description: '毫秒（time）',
            },
            timeout: {
                type: 'number',
                description: '超时',
            },
        },
        required: ['for'],
    },
}

/**
 * wait 参数 schema
 */
const waitSchema = z.object({
                                for: z.enum(['element', 'navigation', 'time', 'idle']),
                                target: targetZodSchema.optional(),
                                state: z.enum(['visible', 'hidden', 'attached', 'detached']).optional(),
                                ms: z.number().optional(),
                                timeout: z.number().optional(),
                            })

type WaitParams = z.infer<typeof waitSchema>;

/**
 * wait 工具处理器
 */
export async function handleWait(params: unknown): Promise<{
    content: Array<{ type: 'text'; text: string }>;
    isError?: boolean;
}> {
    try {
        const args    = waitSchema.parse(params)
        const session = getSession()
        const timeout = args.timeout ?? 30000

        switch (args.for) {
            case 'element': {
                if (!args.target) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify({
                                                         error: {
                                                             code: 'INVALID_ARGUMENT',
                                                             message: '等待元素需要 target 参数',
                                                         },
                                                     }),
                            },
                        ],
                        isError: true,
                    }
                }
                const state = args.state ?? 'visible'
                await waitForElement(session, args.target, state, timeout)
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                                     success: true,
                                                     waited: 'element',
                                                     state,
                                                 }),
                        },
                    ],
                }
            }

            case 'navigation': {
                // 等待页面加载完成
                await waitForNavigation(session, timeout)
                const sessionState = session.getState()
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                                     success: true,
                                                     waited: 'navigation',
                                                     url: sessionState?.url,
                                                     title: sessionState?.title,
                                                 }),
                        },
                    ],
                }
            }

            case 'time': {
                if (!args.ms) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify({
                                                         error: {
                                                             code: 'INVALID_ARGUMENT',
                                                             message: '等待时间需要 ms 参数',
                                                         },
                                                     }),
                            },
                        ],
                        isError: true,
                    }
                }
                await new Promise((resolve) => setTimeout(resolve, args.ms))
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                                     success: true,
                                                     waited: 'time',
                                                     ms: args.ms,
                                                 }),
                        },
                    ],
                }
            }

            case 'idle': {
                // 等待网络空闲
                await waitForNetworkIdle(session, timeout)
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                                     success: true,
                                                     waited: 'idle',
                                                 }),
                        },
                    ],
                }
            }

            default:
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                                     error: {
                                                         code: 'INVALID_ARGUMENT',
                                                         message: `未知等待类型: ${args.for}`,
                                                     },
                                                 }),
                        },
                    ],
                    isError: true,
                }
        }
    } catch (error) {
        return formatErrorResponse(error)
    }
}

/**
 * 等待元素
 */
async function waitForElement(
    session: ReturnType<typeof getSession>,
    target: Target,
    state: ElementState,
    timeout: number,
): Promise<void> {
    const startTime  = Date.now()
    const retryDelay = 100

    while (Date.now() - startTime < timeout) {
        try {
            const locator = session.createLocator(target)

            switch (state) {
                case 'attached':
                case 'visible': {
                    // 尝试找到元素
                    await locator.find()

                    if (state === 'visible') {
                        // 还需要检查可见性
                        const box = await locator.getBoundingBox()
                        if (box.width > 0 && box.height > 0) {
                            return // 元素可见
                        }
                    } else {
                        return // 元素存在
                    }
                    break
                }

                case 'detached':
                case 'hidden': {
                    try {
                        await locator.find()
                        if (state === 'hidden') {
                            // 元素存在，检查是否隐藏
                            const box = await locator.getBoundingBox()
                            if (box.width === 0 || box.height === 0) {
                                return // 元素隐藏
                            }
                        }
                        // 元素仍然存在，继续等待
                    } catch {
                        // 元素不存在，符合预期
                        return
                    }
                    break
                }
            }
        } catch {
            // 元素未找到
            if (state === 'detached' || state === 'hidden') {
                return // 符合预期
            }
            // 继续等待
        }

        await new Promise((resolve) => setTimeout(resolve, retryDelay))
    }

    throw new TimeoutError(
        `等待元素 ${JSON.stringify(target)} 状态 ${state} 超时 (${timeout}ms)`,
    )
}

/**
 * 等待导航完成（复用 session 的事件驱动实现）
 */
async function waitForNavigation(
    session: ReturnType<typeof getSession>,
    timeout: number,
): Promise<void> {
    await session.waitForNavigation(timeout)
}

/**
 * 等待网络空闲（复用 session 的事件驱动实现）
 */
async function waitForNetworkIdle(
    session: ReturnType<typeof getSession>,
    timeout: number,
): Promise<void> {
    await session.waitForNetworkIdle(timeout)
}
