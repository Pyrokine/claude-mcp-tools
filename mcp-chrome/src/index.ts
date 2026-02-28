#!/usr/bin/env node

/**
 * mcp-chrome - 浏览器自动化 MCP Server
 *
 * 基于 Chrome DevTools Protocol (CDP) 的浏览器自动化工具
 *
 * 特点：
 * - 8 个精简工具（browse、input、extract、wait、cookies、logs、evaluate、manage）
 * - 可访问性树定位（稳定、语义化）
 * - 内置反检测（指纹伪装、CDP 痕迹清理）
 * - 事件序列模型（支持任意键鼠组合）
 */

import {Server} from '@modelcontextprotocol/sdk/server/index.js'
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js'
import {CallToolRequestSchema, ListToolsRequestSchema} from '@modelcontextprotocol/sdk/types.js'

import {getSession, getUnifiedSession} from './core/index.js'
import {
    browseToolDefinition,
    cookiesToolDefinition,
    evaluateToolDefinition,
    extractToolDefinition,
    handleBrowse,
    handleCookies,
    handleEvaluate,
    handleExtract,
    handleInput,
    handleLogs,
    handleManage,
    handleWait,
    inputToolDefinition,
    logsToolDefinition,
    manageToolDefinition,
    waitToolDefinition,
} from './tools/index.js'

/**
 * 所有工具定义
 */
const tools = [
    browseToolDefinition,
    inputToolDefinition,
    extractToolDefinition,
    waitToolDefinition,
    cookiesToolDefinition,
    logsToolDefinition,
    evaluateToolDefinition,
    manageToolDefinition,
]

/**
 * 工具处理器映射
 */
const handlers: Record<
    string,
    (params: unknown) => Promise<{
        content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
        isError?: boolean;
    }>
> = {
    browse: handleBrowse,
    input: handleInput,
    extract: handleExtract,
    wait: handleWait,
    cookies: handleCookies,
    logs: handleLogs,
    evaluate: handleEvaluate,
    manage: handleManage,
}

/**
 * 创建 MCP Server
 */
function createServer(): Server {
    const server = new Server(
        {
            name: 'mcp-chrome',
            version: '1.1.0',
        },
        {
            capabilities: {
                tools: {},
            },
        },
    )

    // 列出工具
    server.setRequestHandler(ListToolsRequestSchema, async () => {
        return {tools}
    })

    // 调用工具
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const {name, arguments: args} = request.params

        const handler = handlers[name]
        if (!handler) {
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                                                 error: {
                                                     code: 'UNKNOWN_TOOL',
                                                     message: `未知工具: ${name}`,
                                                     suggestion: `可用工具: ${Object.keys(handlers).join(', ')}`,
                                                 },
                                             }),
                    },
                ],
                isError: true,
            }
        }

        return handler(args)
    })

    return server
}

/**
 * 清理资源
 */
async function cleanup(): Promise<void> {
    try {
        // 关闭统一会话（包括 Extension 和 CDP）
        await getUnifiedSession().close()
    } catch {
        // 忽略清理错误
    }
}

/**
 * 主函数
 */
async function main(): Promise<void> {
    // 启动 Extension HTTP/WebSocket 服务器
    await getUnifiedSession().startExtensionServer()

    const server    = createServer()
    const transport = new StdioServerTransport()

    await server.connect(transport)

    // 优雅退出
    process.on('SIGINT', async () => {
        await cleanup()
        await server.close()
        process.exit(0)
    })

    process.on('SIGTERM', async () => {
        await cleanup()
        await server.close()
        process.exit(0)
    })
}

main().catch(async (error) => {
    console.error('启动失败:', error)
    await cleanup()
    process.exit(1)
})
