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
 */

import {z} from 'zod'
import {devices, formatErrorResponse, getSession} from '../core/index.js'
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
                ],
                description: '管理操作',
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
                                                 ]),
                                  targetId: z.string().optional(),
                                  cacheType: z.enum(['all', 'cookies', 'storage', 'cache']).optional(),
                                  width: z.number().optional(),
                                  height: z.number().optional(),
                                  userAgent: z.string().optional(),
                                  device: z.string().optional(),
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
        const args    = manageSchema.parse(params)
        const session = getSession()

        switch (args.action) {
            case 'newPage': {
                const target = await session.newPage()
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                                     success: true,
                                                     action: 'newPage',
                                                     target,
                                                 }),
                        },
                    ],
                }
            }

            case 'closePage': {
                await session.closePage(args.targetId)
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                                     success: true,
                                                     action: 'closePage',
                                                     targetId: args.targetId ?? 'current',
                                                 }),
                        },
                    ],
                }
            }

            case 'clearCache': {
                await session.clearCache((args.cacheType ?? 'all') as CacheType)
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                                     success: true,
                                                     action: 'clearCache',
                                                     cacheType: args.cacheType ?? 'all',
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
                await session.setViewport(args.width, args.height)
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                                     success: true,
                                                     action: 'viewport',
                                                     width: args.width,
                                                     height: args.height,
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
                await session.setUserAgent(args.userAgent)
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                                     success: true,
                                                     action: 'userAgent',
                                                     userAgent: args.userAgent,
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

                await session.setViewport(device.viewport.width, device.viewport.height)
                await session.setUserAgent(device.userAgent)

                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                                     success: true,
                                                     action: 'emulate',
                                                     device: args.device,
                                                     viewport: device.viewport,
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
