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
import {formatErrorResponse, getSession, getUnifiedSession} from '../core/index.js'
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
            // launch/connect 参数
            port: {
                type: 'number',
                description: '调试端口（launch/connect）。launch 时不指定则使用随机端口',
            },
            host: {
                type: 'string',
                description: '调试主机（connect）',
            },
            // attach 参数
            targetId: {
                type: 'string',
                description: '目标 ID（attach）。从 list 结果中获取。Extension 模式为数字 Tab ID，CDP 模式为 WebSocket target ID。仅在当前 mode 下有效',
            },
            activate: {
                type: 'boolean',
                description: '是否激活 Tab（attach）。默认 false 只设置操作目标不切到前台',
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
                                  port: z.coerce.number().optional(),
                                  host: z.string().optional(),
                                  targetId: z.string().optional(),
                                  activate: z.boolean().optional(),
                                  url: z.string().optional(),
                                  wait: z.enum(['load', 'domcontentloaded', 'networkidle']).optional(),
                                  ignoreCache: z.boolean().optional(),
                                  timeout: z.coerce.number().optional(),
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
        const args           = browseSchema.parse(params)
        const unifiedSession = getUnifiedSession()
        const cdpSession     = getSession()

        // 优先使用 Extension 模式（如果启用了，即使当前断开也使用，会自动等待重连）
        const useExtension = unifiedSession.isExtensionModeEnabled()

        switch (args.action) {
            case 'launch': {
                // Extension 模式：直接创建新 Tab
                if (useExtension) {
                    const target = await unifiedSession.launch({
                        port: args.port,
                        executablePath: args.executablePath,
                        headless: args.headless,
                        userDataDir: args.userDataDir,
                        incognito: args.incognito,
                        timeout: args.timeout,
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
                                        mode: target.mode,
                                        note: target.mode === 'extension'
                                              ? 'Extension 模式：使用用户浏览器，共享登录状态'
                                              : '已启动新浏览器（Extension 未连接，fallback 到 CDP 模式）',
                                        target,
                                    },
                                    null,
                                    2,
                                ),
                            },
                        ],
                    }
                }

                // CDP 模式：启动新浏览器
                const target = await cdpSession.launch({
                                                           executablePath: args.executablePath,
                                                           port: args.port ?? 0,
                                                           incognito: args.incognito ?? false,
                                                           headless: args.headless ?? false,
                                                           userDataDir: args.userDataDir,
                                                           timeout: args.timeout ?? 30000,
                                                           stealth: args.stealth as 'off' | 'safe' | 'aggressive' | undefined,
                                                       })
                const reused = target.reused ?? false
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(
                                {
                                    success: true,
                                    action: 'launch',
                                    mode: 'cdp',
                                    port: cdpSession.port,
                                    reused,
                                    note: reused
                                          ? '已复用运行中的浏览器，保留登录状态'
                                          : '已启动新浏览器，登录状态保存在 ~/.mcp-chrome/profile',
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
                // 显式传 port 时走 CDP 连接（即使 Extension 服务器已启动）
                if (useExtension && !args.port) {
                    const connected = unifiedSession.isExtensionConnected()
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify({
                                                         success: connected,
                                                         action: 'connect',
                                                         mode: 'extension',
                                                         connected,
                                                         note: connected
                                                               ? 'Extension 模式已连接，无需 connect'
                                                               : 'Extension 服务器已启动但未连接，请确保 Chrome 已运行且安装了 MCP Chrome 扩展',
                                                     }),
                            },
                        ],
                    }
                }

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
                const target = await cdpSession.connect({
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
                                    mode: 'cdp',
                                    port: args.port,
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
                const mode = unifiedSession.getMode()
                const targets = await unifiedSession.listTargets()

                const result: Record<string, unknown> = {
                    success: true,
                    action: 'list',
                    mode,
                    targets,
                }

                // 当没有连接时，提供安装提示
                if (mode === 'none') {
                    result.note = '未连接浏览器。请确保 Chrome 已运行且 MCP Chrome 扩展已安装。'
                }

                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2),
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
                if (args.activate) {
                    // 激活 Tab（切到前台）
                    await unifiedSession.activatePage(args.targetId)
                } else {
                    // 只设置操作目标，不激活（不切到前台）
                    await unifiedSession.selectPage(args.targetId)
                }
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                                     success: true,
                                                     action: 'attach',
                                                     mode: unifiedSession.getMode(),
                                                     targetId: args.targetId,
                                                     activated: args.activate ?? false,
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
                await unifiedSession.navigate(args.url, {
                    wait: args.wait as WaitUntil,
                    timeout: args.timeout ?? 30000,
                })
                const state = unifiedSession.getState()
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(
                                {
                                    success: true,
                                    action: 'open',
                                    mode: unifiedSession.getMode(),
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
                const result = await unifiedSession.goBack(args.timeout)
                const state = unifiedSession.getState()
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                                     success: true,
                                                     action: 'back',
                                                     mode: unifiedSession.getMode(),
                                                     navigated: result.navigated,
                                                     url: state?.url,
                                                     title: state?.title,
                                                     ...(result.navigated ? {} : {note: '无后退历史'}),
                                                 }),
                        },
                    ],
                }
            }

            case 'forward': {
                const result = await unifiedSession.goForward(args.timeout)
                const state = unifiedSession.getState()
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                                     success: true,
                                                     action: 'forward',
                                                     mode: unifiedSession.getMode(),
                                                     navigated: result.navigated,
                                                     url: state?.url,
                                                     title: state?.title,
                                                     ...(result.navigated ? {} : {note: '无前进历史'}),
                                                 }),
                        },
                    ],
                }
            }

            case 'refresh': {
                await unifiedSession.reload({
                                                ignoreCache: args.ignoreCache ?? false,
                                                waitUntil: args.wait,
                                                timeout: args.timeout ?? 30000,
                                            })
                const state = unifiedSession.getState()
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                                     success: true,
                                                     action: 'refresh',
                                                     mode: unifiedSession.getMode(),
                                                     url: state?.url,
                                                     title: state?.title,
                                                 }),
                        },
                    ],
                }
            }

            case 'close': {
                // 根据实际连接状态决定关闭行为，而非 extensionBridge 是否存在
                const currentMode = unifiedSession.getMode()
                if (currentMode !== 'cdp') {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify({
                                                         success: true,
                                                         action: 'close',
                                                         mode: currentMode,
                                                         note: currentMode === 'extension'
                                                               ? 'Extension 模式：会话已结束，浏览器保持打开'
                                                               : '无活跃连接',
                                                     }),
                            },
                        ],
                    }
                }

                await cdpSession.close()
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                                     success: true,
                                                     action: 'close',
                                                     mode: 'cdp',
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

