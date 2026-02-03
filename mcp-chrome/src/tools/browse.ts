/**
 * browse 工具
 *
 * 浏览器管理与导航：
 * - launch: 启动新浏览器
 * - connect: 连接已运行的浏览器
 * - list: 列出所有可用页面
 * - attach: 附加到指定页面
 * - open: 打开 URL
 * - back/forward: 前进后退
 * - refresh: 刷新
 * - close: 关闭浏览器
 */

import {z} from 'zod'
import {formatErrorResponse, getSession} from '../core/index.js'
import type {WaitUntil} from '../core/types.js'

/**
 * browse 工具定义
 */
export const browseToolDefinition = {
    name: 'browse',
    description: '浏览器管理与导航：启动、连接、列出页面、打开 URL、导航',
    inputSchema: {
        type: 'object' as const,
        properties: {
            action: {
                type: 'string',
                enum: [
                    'launch',
                    'connect',
                    'list',
                    'attach',
                    'open',
                    'back',
                    'forward',
                    'refresh',
                    'close',
                ],
                description: '操作类型',
            },
            // launch 参数
            executablePath: {
                type: 'string',
                description: 'Chrome 可执行文件路径（launch）。不指定则自动查找',
            },
            incognito: {
                type: 'boolean',
                description: '是否以隐身模式启动（launch）',
            },
            headless: {
                type: 'boolean',
                description: '是否无头模式（launch）。注意：无头模式易被检测',
            },
            userDataDir: {
                type: 'string',
                description: '用户数据目录（launch）。指定后可复用登录状态',
            },
            stealth: {
                type: 'string',
                enum: ['off', 'safe', 'aggressive'],
                description: '反检测模式（launch/connect）。off=关闭，safe=最小改动（默认），aggressive=完整伪装',
            },
            // connect 参数
            port: {
                type: 'number',
                description: '调试端口（connect）',
            },
            host: {
                type: 'string',
                description: '调试主机（connect）',
            },
            // attach 参数
            targetId: {
                type: 'string',
                description: '目标 ID（attach）。从 list 结果中获取',
            },
            // open 参数
            url: {
                type: 'string',
                description: '目标 URL（open）',
            },
            wait: {
                type: 'string',
                enum: ['load', 'domcontentloaded', 'networkidle'],
                description: '等待条件（open/refresh）',
            },
            // refresh 参数
            ignoreCache: {
                type: 'boolean',
                description: '刷新时是否忽略缓存（refresh）',
            },
            // 通用参数
            timeout: {
                type: 'number',
                description: '超时毫秒',
            },
        },
        required: ['action'],
    },
}

/**
 * browse 参数 schema
 */
const browseSchema = z.object({
                                  action: z.enum([
                                                     'launch',
                                                     'connect',
                                                     'list',
                                                     'attach',
                                                     'open',
                                                     'back',
                                                     'forward',
                                                     'refresh',
                                                     'close',
                                                 ]),
                                  executablePath: z.string().optional(),
                                  incognito: z.boolean().optional(),
                                  headless: z.boolean().optional(),
                                  userDataDir: z.string().optional(),
                                  stealth: z.enum(['off', 'safe', 'aggressive']).optional(),
                                  port: z.number().optional(),
                                  host: z.string().optional(),
                                  targetId: z.string().optional(),
                                  url: z.string().optional(),
                                  wait: z.enum(['load', 'domcontentloaded', 'networkidle']).optional(),
                                  ignoreCache: z.boolean().optional(),
                                  timeout: z.number().optional(),
                              })

type BrowseParams = z.infer<typeof browseSchema>;

/**
 * browse 工具处理器
 */
export async function handleBrowse(params: unknown): Promise<{
    content: Array<{ type: 'text'; text: string }>;
    isError?: boolean;
}> {
    try {
        const args    = browseSchema.parse(params)
        const session = getSession()

        switch (args.action) {
            case 'launch': {
                const target = await session.launch({
                                                        executablePath: args.executablePath,
                                                        incognito: args.incognito ?? false,
                                                        headless: args.headless ?? false,
                                                        userDataDir: args.userDataDir,
                                                        timeout: args.timeout ?? 30000,
                                                        stealth: args.stealth as 'off' | 'safe' | 'aggressive' | undefined,
                                                    })
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(
                                {
                                    success: true,
                                    action: 'launch',
                                    target,
                                },
                                null,
                                2,
                            ),
                        },
                    ],
                }
            }

            case 'connect': {
                if (!args.port) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify({
                                                         error: {
                                                             code: 'INVALID_ARGUMENT',
                                                             message: '缺少 port 参数',
                                                             suggestion: '请指定 port 参数，例如：browse(action="connect", port=9222)',
                                                         },
                                                     }),
                            },
                        ],
                        isError: true,
                    }
                }
                const target = await session.connect({
                                                         host: args.host ?? '127.0.0.1',
                                                         port: args.port,
                                                         timeout: args.timeout ?? 30000,
                                                         stealth: args.stealth as 'off' | 'safe' | 'aggressive' | undefined,
                                                     })
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(
                                {
                                    success: true,
                                    action: 'connect',
                                    target,
                                },
                                null,
                                2,
                            ),
                        },
                    ],
                }
            }

            case 'list': {
                const targets = await session.listTargets()
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(
                                {
                                    success: true,
                                    action: 'list',
                                    targets,
                                },
                                null,
                                2,
                            ),
                        },
                    ],
                }
            }

            case 'attach': {
                if (!args.targetId) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify({
                                                         error: {
                                                             code: 'INVALID_ARGUMENT',
                                                             message: '缺少 targetId 参数',
                                                             suggestion:
                                                                 '请先使用 browse(action="list") 获取可用页面，然后使用 targetId 附加',
                                                         },
                                                     }),
                            },
                        ],
                        isError: true,
                    }
                }
                await session.attachToTarget(args.targetId)
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                                     success: true,
                                                     action: 'attach',
                                                     targetId: args.targetId,
                                                 }),
                        },
                    ],
                }
            }

            case 'open': {
                if (!args.url) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify({
                                                         error: {
                                                             code: 'INVALID_ARGUMENT',
                                                             message: '缺少 url 参数',
                                                             suggestion: '请指定 url 参数',
                                                         },
                                                     }),
                            },
                        ],
                        isError: true,
                    }
                }
                await session.navigate(args.url, {
                    wait: args.wait as WaitUntil,
                    timeout: args.timeout ?? 30000,
                })
                const state = session.getState()
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(
                                {
                                    success: true,
                                    action: 'open',
                                    url: state?.url,
                                    title: state?.title,
                                },
                                null,
                                2,
                            ),
                        },
                    ],
                }
            }

            case 'back': {
                await session.goBack()
                const state = session.getState()
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                                     success: true,
                                                     action: 'back',
                                                     url: state?.url,
                                                     title: state?.title,
                                                 }),
                        },
                    ],
                }
            }

            case 'forward': {
                await session.goForward()
                const state = session.getState()
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                                     success: true,
                                                     action: 'forward',
                                                     url: state?.url,
                                                     title: state?.title,
                                                 }),
                        },
                    ],
                }
            }

            case 'refresh': {
                await session.reload({
                                         ignoreCache: args.ignoreCache ?? false,
                                         timeout: args.timeout ?? 30000,
                                     })
                const state = session.getState()
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                                     success: true,
                                                     action: 'refresh',
                                                     url: state?.url,
                                                     title: state?.title,
                                                 }),
                        },
                    ],
                }
            }

            case 'close': {
                await session.close()
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                                     success: true,
                                                     action: 'close',
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
                                                         message: `未知操作: ${args.action}`,
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
