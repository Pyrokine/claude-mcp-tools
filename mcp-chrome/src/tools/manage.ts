/**
 * manage 工具
 *
 * 页面与环境管理：
 * - newPage: 新建页面
 * - closePage: 关闭页面
 * - clearCache: 清除缓存
 * - viewport: 设置视口
 * - userAgent: 设置 User-Agent
 * - emulate: 设备模拟
 * - inputMode: 设置输入模式（stealth/precise）
 * - stealth: 注入反检测脚本
 * - cdp: 发送任意 CDP 命令（高级）
 */

import {z} from 'zod'
import {devices, formatErrorResponse, getSession, getUnifiedSession} from '../core/index.js'
import type {CacheType} from '../core/types.js'

/**
 * manage 工具定义
 */
export const manageToolDefinition = {
    name: 'manage',
    description: '页面与环境管理：新建页面、关闭页面、缓存、视口、UA、设备模拟',
    inputSchema: {
        type: 'object' as const,
        properties: {
            action: {
                type: 'string',
                enum: [
                    'newPage',
                    'closePage',
                    'clearCache',
                    'viewport',
                    'userAgent',
                    'emulate',
                    'inputMode',
                    'stealth',
                    'cdp',
                ],
                description: '管理操作',
            },
            inputMode: {
                type: 'string',
                enum: ['stealth', 'precise'],
                description: '输入模式（inputMode）。precise=debugger API（默认，可绕过 CSP 但显示调试提示）；stealth=JS 事件模拟（不触发调试提示但受 CSP 限制，适用于反检测场景）',
            },
            cdpMethod: {
                type: 'string',
                description: 'CDP 方法名（cdp），如 Runtime.evaluate、Page.captureScreenshot',
            },
            cdpParams: {
                type: 'object',
                description: 'CDP 方法参数（cdp）',
            },
            targetId: {
                type: 'string',
                description: '目标页面 ID（closePage）',
            },
            cacheType: {
                type: 'string',
                enum: ['all', 'cookies', 'storage', 'cache'],
                description: '清除类型（clearCache）',
            },
            width: {
                type: 'number',
                description: '视口宽度（viewport）',
            },
            height: {
                type: 'number',
                description: '视口高度（viewport）',
            },
            userAgent: {
                type: 'string',
                description: 'User-Agent 字符串（userAgent）',
            },
            device: {
                type: 'string',
                description: '设备名称（emulate），如 iPhone 13, iPad Pro',
            },
        },
        required: ['action'],
    },
}

/**
 * manage 参数 schema
 */
const manageSchema = z.object({
                                  action: z.enum([
                                                     'newPage',
                                                     'closePage',
                                                     'clearCache',
                                                     'viewport',
                                                     'userAgent',
                                                     'emulate',
                                                     'inputMode',
                                                     'stealth',
                                                     'cdp',
                                                 ]),
                                  targetId: z.string().optional(),
                                  cacheType: z.enum(['all', 'cookies', 'storage', 'cache']).optional(),
                                  width: z.number().optional(),
                                  height: z.number().optional(),
                                  userAgent: z.string().optional(),
                                  device: z.string().optional(),
                                  inputMode: z.enum(['stealth', 'precise']).optional(),
                                  cdpMethod: z.string().optional(),
                                  cdpParams: z.record(z.unknown()).optional(),
                              })

type ManageParams = z.infer<typeof manageSchema>;

/**
 * manage 工具处理器
 */
export async function handleManage(params: unknown): Promise<{
    content: Array<{ type: 'text'; text: string }>;
    isError?: boolean;
}> {
    try {
        const args           = manageSchema.parse(params)
        const unifiedSession = getUnifiedSession()
        const mode           = unifiedSession.getMode()

        switch (args.action) {
            case 'newPage': {
                const target = await unifiedSession.newPage()
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                                     success: true,
                                                     action: 'newPage',
                                                     target,
                                                     mode,
                                                 }),
                        },
                    ],
                }
            }

            case 'closePage': {
                await unifiedSession.closePage(args.targetId)
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                                     success: true,
                                                     action: 'closePage',
                                                     targetId: args.targetId ?? 'current',
                                                     mode,
                                                 }),
                        },
                    ],
                }
            }

            case 'clearCache': {
                const cacheType = (args.cacheType ?? 'all') as CacheType

                if (mode === 'extension') {
                    // Extension 模式：只支持 cookies 清除
                    if (cacheType === 'all' || cacheType === 'cookies') {
                        await unifiedSession.clearCookies()
                    }
                    if (cacheType === 'storage' || cacheType === 'cache') {
                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: JSON.stringify({
                                                             success: true,
                                                             action: 'clearCache',
                                                             cacheType,
                                                             mode,
                                                             warning: 'Extension 模式仅支持清除 cookies，storage 和 cache 需要 CDP 模式',
                                                         }),
                                },
                            ],
                        }
                    }
                } else {
                    const session = getSession()
                    await session.clearCache(cacheType)
                }

                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                                     success: true,
                                                     action: 'clearCache',
                                                     cacheType,
                                                     mode,
                                                 }),
                        },
                    ],
                }
            }

            case 'viewport': {
                if (args.width === undefined || args.height === undefined) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify({
                                                         error: {
                                                             code: 'INVALID_ARGUMENT',
                                                             message: '设置视口需要 width 和 height 参数',
                                                         },
                                                     }),
                            },
                        ],
                        isError: true,
                    }
                }

                if (mode === 'extension') {
                    // Extension 模式：使用 debugger API 设置视口
                    await unifiedSession.sendCdpCommand('Emulation.setDeviceMetricsOverride', {
                        width: args.width,
                        height: args.height,
                        deviceScaleFactor: 1,
                        mobile: false,
                    })
                } else {
                    const session = getSession()
                    await session.setViewport(args.width, args.height)
                }

                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                                     success: true,
                                                     action: 'viewport',
                                                     width: args.width,
                                                     height: args.height,
                                                     mode,
                                                 }),
                        },
                    ],
                }
            }

            case 'userAgent': {
                if (!args.userAgent) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify({
                                                         error: {
                                                             code: 'INVALID_ARGUMENT',
                                                             message: '设置 User-Agent 需要 userAgent 参数',
                                                         },
                                                     }),
                            },
                        ],
                        isError: true,
                    }
                }

                if (mode === 'extension') {
                    // Extension 模式：使用 debugger API 设置 UA
                    await unifiedSession.sendCdpCommand('Emulation.setUserAgentOverride', {
                        userAgent: args.userAgent,
                    })
                } else {
                    const session = getSession()
                    await session.setUserAgent(args.userAgent)
                }

                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                                     success: true,
                                                     action: 'userAgent',
                                                     userAgent: args.userAgent,
                                                     mode,
                                                 }),
                        },
                    ],
                }
            }

            case 'inputMode': {
                if (!args.inputMode) {
                    // 返回当前模式
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify({
                                                         success: true,
                                                         action: 'inputMode',
                                                         currentMode: unifiedSession.getInputMode(),
                                                         availableModes: ['stealth', 'precise'],
                                                         description: {
                                                             stealth: 'JS 事件模拟，不触发调试提示，但受 CSP 限制（evaluate 可能失败）',
                                                             precise: 'debugger API，可绕过 CSP，但显示"扩展程序正在调试此浏览器"',
                                                         },
                                                     }),
                            },
                        ],
                    }
                }

                unifiedSession.setInputMode(args.inputMode)
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                                     success: true,
                                                     action: 'inputMode',
                                                     inputMode: args.inputMode,
                                                     mode,
                                                 }),
                        },
                    ],
                }
            }

            case 'emulate': {
                if (!args.device) {
                    // 列出可用设备
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify({
                                                         success: true,
                                                         action: 'emulate',
                                                         availableDevices: Object.keys(devices),
                                                     }),
                            },
                        ],
                    }
                }

                const device = devices[args.device]
                if (!device) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify({
                                                         error: {
                                                             code: 'INVALID_ARGUMENT',
                                                             message: `未知设备: ${args.device}`,
                                                             suggestion: `可用设备: ${Object.keys(devices).join(', ')}`,
                                                         },
                                                     }),
                            },
                        ],
                        isError: true,
                    }
                }

                if (mode === 'extension') {
                    // Extension 模式：使用 debugger API
                    await unifiedSession.sendCdpCommand('Emulation.setDeviceMetricsOverride', {
                        width: device.viewport.width,
                        height: device.viewport.height,
                        deviceScaleFactor: device.viewport.deviceScaleFactor || 1,
                        mobile: device.viewport.isMobile || false,
                    })
                    await unifiedSession.sendCdpCommand('Emulation.setUserAgentOverride', {
                        userAgent: device.userAgent,
                    })
                } else {
                    const session = getSession()
                    await session.setViewport(device.viewport.width, device.viewport.height)
                    await session.setUserAgent(device.userAgent)
                }

                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                                     success: true,
                                                     action: 'emulate',
                                                     device: args.device,
                                                     viewport: device.viewport,
                                                     mode,
                                                 }),
                        },
                    ],
                }
            }

            case 'stealth': {
                await unifiedSession.injectStealth()
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                                     success: true,
                                                     action: 'stealth',
                                                     mode,
                                                     note: '已注入反检测脚本',
                                                 }),
                        },
                    ],
                }
            }

            case 'cdp': {
                if (!args.cdpMethod) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify({
                                                         error: {
                                                             code: 'INVALID_ARGUMENT',
                                                             message: '缺少 cdpMethod 参数',
                                                             suggestion: '请指定 CDP 方法名，如 Runtime.evaluate、Page.captureScreenshot',
                                                         },
                                                     }),
                            },
                        ],
                        isError: true,
                    }
                }

                try {
                    const result = await unifiedSession.sendCdpCommand(args.cdpMethod, args.cdpParams)
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify(
                                    {
                                        success: true,
                                        action: 'cdp',
                                        method: args.cdpMethod,
                                        result,
                                        mode,
                                    },
                                    null,
                                    2,
                                ),
                            },
                        ],
                    }
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error)
                    // Extension 模式下某些 CDP 域不支持
                    if (mode === 'extension' && (errorMessage.includes('not supported') || errorMessage.includes('not found'))) {
                        const domain = args.cdpMethod.split('.')[0]
                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: JSON.stringify({
                                                             error: {
                                                                 code: 'CDP_DOMAIN_NOT_SUPPORTED',
                                                                 message: `Extension 模式不支持 ${domain} 域`,
                                                                 suggestion: 'Extension 模式可用域：Page、Runtime、Emulation、DOM、Input、Network。如需完整 CDP 支持，请使用 CDP 模式（browse action="launch"）',
                                                             },
                                                         }),
                                },
                            ],
                            isError: true,
                        }
                    }
                    throw error
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
