/**
 * logs 工具
 *
 * 浏览器日志：
 * - console: 控制台日志
 * - network: 网络请求日志
 */

import {writeFile} from 'fs/promises'
import {z} from 'zod'
import {formatErrorResponse, getSession, getUnifiedSession} from '../core/index.js'

/**
 * logs 工具定义
 */
export const logsToolDefinition = {
    name: 'logs',
    description: '浏览器日志：控制台日志、网络请求',
    inputSchema: {
        type: 'object' as const,
        properties: {
            type: {
                type: 'string',
                enum: ['console', 'network'],
                description: '日志类型',
            },
            level: {
                type: 'string',
                enum: ['all', 'error', 'warning', 'info', 'debug'],
                description: '日志级别过滤（console）',
            },
            urlPattern: {
                type: 'string',
                description: 'URL 模式过滤（network），支持通配符',
            },
            limit: {
                type: 'number',
                description: '最大返回条数',
            },
            clear: {
                type: 'boolean',
                description: '获取后清除日志',
            },
            output: {
                type: 'string',
                description: '输出文件路径。若指定，日志导出为 JSON 文件',
            },
            tabId: {
                type: 'string',
                description: '目标 Tab ID（可选，仅 Extension 模式）。不指定则使用当前 attach 的 tab。可操作非当前 attach 的 tab。CDP 模式下忽略此参数',
            },
        },
        required: ['type'],
    },
}

/**
 * logs 参数 schema
 */
const logsSchema = z.object({
                                type: z.enum(['console', 'network']),
                                level: z.enum(['all', 'error', 'warning', 'info', 'debug']).optional(),
                                urlPattern: z.string().optional(),
                                limit: z.number().optional(),
                                clear: z.boolean().optional(),
                                output: z.string().optional(),
                                tabId: z.string().optional(),
                            })

type LogsParams = z.infer<typeof logsSchema>;

/**
 * logs 工具处理器
 */
export async function handleLogs(params: unknown): Promise<{
    content: Array<{ type: 'text'; text: string }>;
    isError?: boolean;
}> {
    try {
        const args           = logsSchema.parse(params)
        const unifiedSession = getUnifiedSession()
        const mode           = unifiedSession.getMode()
        const limit          = args.limit ?? 100

        return await unifiedSession.withTabId(args.tabId, async () => {

        switch (args.type) {
            case 'console': {
                let logs: Array<{
                    source?: string
                    level: string
                    text: string
                    timestamp?: number
                    url?: string
                    lineNumber?: number
                }>

                if (mode === 'extension') {
                    // Extension 模式：使用 debugger API 获取控制台日志
                    await unifiedSession.enableConsole()
                    const extLogs = await unifiedSession.getConsoleLogs({
                        level: args.level === 'all' ? undefined : args.level,
                        clear: args.clear,
                    })
                    logs = extLogs.slice(0, limit)
                } else {
                    // CDP 模式
                    const session = getSession()
                    logs = session.getConsoleLogs(args.level, limit)

                    if (args.clear) {
                        session.clearLogs()
                    }
                }

                if (args.output) {
                    await writeFile(args.output, JSON.stringify(logs, null, 2), 'utf-8')
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify({
                                                         success: true,
                                                         type: 'console',
                                                         output: args.output,
                                                         count: logs.length,
                                                         mode,
                                                     }),
                            },
                        ],
                    }
                }

                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(
                                {
                                    success: true,
                                    type: 'console',
                                    logs,
                                    mode,
                                },
                                null,
                                2,
                            ),
                        },
                    ],
                }
            }

            case 'network': {
                let requests: Array<{
                    url: string
                    method: string
                    status?: number
                    type: string
                    timestamp: number
                    duration?: number
                }>

                if (mode === 'extension') {
                    // Extension 模式：使用 debugger API 获取网络日志
                    await unifiedSession.enableNetwork()
                    const extRequests = await unifiedSession.getNetworkRequests({
                        urlPattern: args.urlPattern,
                        clear: args.clear,
                    })
                    requests = extRequests.slice(0, limit)
                } else {
                    // CDP 模式
                    const session = getSession()
                    requests = session.getNetworkRequests(args.urlPattern, limit)

                    if (args.clear) {
                        session.clearLogs()
                    }
                }

                if (args.output) {
                    await writeFile(
                        args.output,
                        JSON.stringify(requests, null, 2),
                        'utf-8',
                    )
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify({
                                                         success: true,
                                                         type: 'network',
                                                         output: args.output,
                                                         count: requests.length,
                                                         mode,
                                                     }),
                            },
                        ],
                    }
                }

                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(
                                {
                                    success: true,
                                    type: 'network',
                                    requests,
                                    mode,
                                },
                                null,
                                2,
                            ),
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
                                                         message: `未知日志类型: ${args.type}`,
                                                     },
                                                 }),
                        },
                    ],
                    isError: true,
                }
        }

        }) // withTabId
    } catch (error) {
        return formatErrorResponse(error)
    }
}

