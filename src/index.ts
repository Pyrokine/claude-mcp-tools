#!/usr/bin/env node
/**
 * SSH MCP Pro - Main Server Entry
 *
 * A comprehensive SSH MCP Server for Claude Code
 *
 * Features:
 * - Multiple authentication methods (password, key, agent)
 * - Connection pooling with keepalive
 * - Session persistence
 * - Command execution (exec, sudo, su)
 * - File operations (upload, download, read, write)
 * - Environment configuration
 * - Jump host support
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';

import { sessionManager } from './session-manager.js';
import * as fileOps from './file-ops.js';
import { ExecOptions } from './types.js';

// 创建 MCP Server
const server = new Server(
  {
    name: 'ssh-mcp-pro',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// 工具定义
const tools: Tool[] = [
  // ========== 连接管理 ==========
  {
    name: 'ssh_connect',
    description: `建立 SSH 连接并保持会话。支持密码、密钥认证，支持跳板机。

示例:
- 密码认证: ssh_connect(host="192.168.1.1", user="root", password="xxx")
- 密钥认证: ssh_connect(host="192.168.1.1", user="root", keyPath="/home/.ssh/id_rsa")
- 自定义别名: ssh_connect(..., alias="myserver")
- 设置环境变量: ssh_connect(..., env={"LANG": "en_US.UTF-8"})`,
    inputSchema: {
      type: 'object',
      properties: {
        host: { type: 'string', description: '服务器地址' },
        user: { type: 'string', description: '用户名' },
        password: { type: 'string', description: '密码（与 keyPath 二选一）' },
        keyPath: { type: 'string', description: 'SSH 私钥路径' },
        port: { type: 'number', description: 'SSH 端口，默认 22', default: 22 },
        alias: { type: 'string', description: '连接别名（可选，用于后续引用）' },
        env: {
          type: 'object',
          description: '环境变量，如 {"LANG": "en_US.UTF-8"}',
          additionalProperties: { type: 'string' },
        },
        keepaliveInterval: { type: 'number', description: '心跳间隔（毫秒），默认 30000' },
      },
      required: ['host', 'user'],
    },
  },
  {
    name: 'ssh_disconnect',
    description: '断开 SSH 连接',
    inputSchema: {
      type: 'object',
      properties: {
        alias: { type: 'string', description: '连接别名' },
      },
      required: ['alias'],
    },
  },
  {
    name: 'ssh_list_sessions',
    description: '列出所有活跃的 SSH 会话',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'ssh_reconnect',
    description: '重新连接已断开的会话',
    inputSchema: {
      type: 'object',
      properties: {
        alias: { type: 'string', description: '连接别名' },
      },
      required: ['alias'],
    },
  },

  // ========== 命令执行 ==========
  {
    name: 'ssh_exec',
    description: `在远程服务器执行命令。

返回: stdout, stderr, exitCode, duration`,
    inputSchema: {
      type: 'object',
      properties: {
        alias: { type: 'string', description: '连接别名' },
        command: { type: 'string', description: '要执行的命令' },
        timeout: { type: 'number', description: '超时（毫秒），默认 30000' },
        cwd: { type: 'string', description: '工作目录（可选）' },
        env: {
          type: 'object',
          description: '额外环境变量',
          additionalProperties: { type: 'string' },
        },
        pty: { type: 'boolean', description: '是否使用 PTY 模式（用于 top 等交互式命令）' },
      },
      required: ['alias', 'command'],
    },
  },
  {
    name: 'ssh_exec_as_user',
    description: `以其他用户身份执行命令（通过 su 切换）。

适用场景: SSH 以 root 登录，但需要以其他用户（如 caros）执行命令。

示例: ssh_exec_as_user(alias="server", command="whoami", targetUser="caros")`,
    inputSchema: {
      type: 'object',
      properties: {
        alias: { type: 'string', description: '连接别名' },
        command: { type: 'string', description: '要执行的命令' },
        targetUser: { type: 'string', description: '目标用户名' },
        timeout: { type: 'number', description: '超时（毫秒）' },
      },
      required: ['alias', 'command', 'targetUser'],
    },
  },
  {
    name: 'ssh_exec_sudo',
    description: '使用 sudo 执行命令',
    inputSchema: {
      type: 'object',
      properties: {
        alias: { type: 'string', description: '连接别名' },
        command: { type: 'string', description: '要执行的命令' },
        sudoPassword: { type: 'string', description: 'sudo 密码（如果需要）' },
        timeout: { type: 'number', description: '超时（毫秒）' },
      },
      required: ['alias', 'command'],
    },
  },
  {
    name: 'ssh_exec_batch',
    description: '批量执行多条命令',
    inputSchema: {
      type: 'object',
      properties: {
        alias: { type: 'string', description: '连接别名' },
        commands: {
          type: 'array',
          items: { type: 'string' },
          description: '命令列表',
        },
        stopOnError: { type: 'boolean', description: '遇到错误是否停止，默认 true' },
        timeout: { type: 'number', description: '每条命令的超时（毫秒）' },
      },
      required: ['alias', 'commands'],
    },
  },
  {
    name: 'ssh_quick_exec',
    description: '一次性执行命令（自动连接、执行、断开）。适用于单次命令，不需要保持连接。',
    inputSchema: {
      type: 'object',
      properties: {
        host: { type: 'string', description: '服务器地址' },
        user: { type: 'string', description: '用户名' },
        command: { type: 'string', description: '要执行的命令' },
        password: { type: 'string', description: '密码' },
        keyPath: { type: 'string', description: '密钥路径' },
        port: { type: 'number', description: '端口', default: 22 },
        timeout: { type: 'number', description: '超时（毫秒）' },
      },
      required: ['host', 'user', 'command'],
    },
  },

  // ========== 文件操作 ==========
  {
    name: 'ssh_upload',
    description: '上传本地文件到远程服务器',
    inputSchema: {
      type: 'object',
      properties: {
        alias: { type: 'string', description: '连接别名' },
        localPath: { type: 'string', description: '本地文件路径' },
        remotePath: { type: 'string', description: '远程目标路径' },
      },
      required: ['alias', 'localPath', 'remotePath'],
    },
  },
  {
    name: 'ssh_download',
    description: '从远程服务器下载文件',
    inputSchema: {
      type: 'object',
      properties: {
        alias: { type: 'string', description: '连接别名' },
        remotePath: { type: 'string', description: '远程文件路径' },
        localPath: { type: 'string', description: '本地保存路径' },
      },
      required: ['alias', 'remotePath', 'localPath'],
    },
  },
  {
    name: 'ssh_read_file',
    description: '读取远程文件内容',
    inputSchema: {
      type: 'object',
      properties: {
        alias: { type: 'string', description: '连接别名' },
        remotePath: { type: 'string', description: '远程文件路径' },
        maxBytes: { type: 'number', description: '最大读取字节数，默认 1MB' },
      },
      required: ['alias', 'remotePath'],
    },
  },
  {
    name: 'ssh_write_file',
    description: '写入内容到远程文件',
    inputSchema: {
      type: 'object',
      properties: {
        alias: { type: 'string', description: '连接别名' },
        remotePath: { type: 'string', description: '远程文件路径' },
        content: { type: 'string', description: '要写入的内容' },
        append: { type: 'boolean', description: '是否追加模式，默认覆盖' },
      },
      required: ['alias', 'remotePath', 'content'],
    },
  },
  {
    name: 'ssh_list_dir',
    description: '列出远程目录内容',
    inputSchema: {
      type: 'object',
      properties: {
        alias: { type: 'string', description: '连接别名' },
        remotePath: { type: 'string', description: '远程目录路径' },
        showHidden: { type: 'boolean', description: '是否显示隐藏文件' },
      },
      required: ['alias', 'remotePath'],
    },
  },
  {
    name: 'ssh_file_info',
    description: '获取远程文件信息（大小、权限、修改时间等）',
    inputSchema: {
      type: 'object',
      properties: {
        alias: { type: 'string', description: '连接别名' },
        remotePath: { type: 'string', description: '远程路径' },
      },
      required: ['alias', 'remotePath'],
    },
  },
  {
    name: 'ssh_mkdir',
    description: '创建远程目录',
    inputSchema: {
      type: 'object',
      properties: {
        alias: { type: 'string', description: '连接别名' },
        remotePath: { type: 'string', description: '远程目录路径' },
        recursive: { type: 'boolean', description: '是否递归创建，默认 false' },
      },
      required: ['alias', 'remotePath'],
    },
  },
];

// 注册工具列表
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools,
}));

// 处理工具调用
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    let result: unknown;

    switch (name) {
      // ========== 连接管理 ==========
      case 'ssh_connect': {
        const alias = await sessionManager.connect({
          host: args.host as string,
          port: (args.port as number) || 22,
          username: args.user as string,
          password: args.password as string | undefined,
          privateKeyPath: args.keyPath as string | undefined,
          alias: args.alias as string | undefined,
          env: args.env as Record<string, string> | undefined,
          keepaliveInterval: args.keepaliveInterval as number | undefined,
        });
        result = {
          success: true,
          alias,
          message: `Connected to ${args.user}@${args.host}:${args.port || 22}`,
        };
        break;
      }

      case 'ssh_disconnect': {
        const success = sessionManager.disconnect(args.alias as string);
        result = {
          success,
          message: success
            ? `Disconnected from ${args.alias}`
            : `Session ${args.alias} not found`,
        };
        break;
      }

      case 'ssh_list_sessions': {
        const sessions = sessionManager.listSessions();
        result = {
          success: true,
          count: sessions.length,
          sessions,
        };
        break;
      }

      case 'ssh_reconnect': {
        await sessionManager.reconnect(args.alias as string);
        result = { success: true, message: `Reconnected to ${args.alias}` };
        break;
      }

      // ========== 命令执行 ==========
      case 'ssh_exec': {
        const execResult = await sessionManager.exec(
          args.alias as string,
          args.command as string,
          {
            timeout: args.timeout as number | undefined,
            cwd: args.cwd as string | undefined,
            env: args.env as Record<string, string> | undefined,
            pty: args.pty as boolean | undefined,
          }
        );
        result = execResult;
        break;
      }

      case 'ssh_exec_as_user': {
        const execResult = await sessionManager.execAsUser(
          args.alias as string,
          args.command as string,
          args.targetUser as string,
          { timeout: args.timeout as number | undefined }
        );
        result = execResult;
        break;
      }

      case 'ssh_exec_sudo': {
        const execResult = await sessionManager.execSudo(
          args.alias as string,
          args.command as string,
          args.sudoPassword as string | undefined,
          { timeout: args.timeout as number | undefined }
        );
        result = execResult;
        break;
      }

      case 'ssh_exec_batch': {
        const commands = args.commands as string[];
        const stopOnError = args.stopOnError !== false;
        const timeout = args.timeout as number | undefined;
        const results: any[] = [];

        for (let i = 0; i < commands.length; i++) {
          try {
            const execResult = await sessionManager.exec(
              args.alias as string,
              commands[i],
              { timeout }
            );
            results.push({
              index: i,
              command: commands[i],
              ...execResult,
            });
            if (execResult.exitCode !== 0 && stopOnError) {
              break;
            }
          } catch (err: any) {
            results.push({
              index: i,
              command: commands[i],
              success: false,
              error: err.message,
            });
            if (stopOnError) break;
          }
        }

        result = {
          success: results.every((r) => r.success),
          total: commands.length,
          executed: results.length,
          results,
        };
        break;
      }

      case 'ssh_quick_exec': {
        const tempAlias = `_quick_${Date.now()}`;
        try {
          await sessionManager.connect({
            host: args.host as string,
            port: (args.port as number) || 22,
            username: args.user as string,
            password: args.password as string | undefined,
            privateKeyPath: args.keyPath as string | undefined,
            alias: tempAlias,
          });
          const execResult = await sessionManager.exec(
            tempAlias,
            args.command as string,
            { timeout: args.timeout as number | undefined }
          );
          result = execResult;
        } finally {
          sessionManager.disconnect(tempAlias);
        }
        break;
      }

      // ========== 文件操作 ==========
      case 'ssh_upload': {
        const uploadResult = await fileOps.uploadFile(
          args.alias as string,
          args.localPath as string,
          args.remotePath as string
        );
        result = { ...uploadResult, message: `Uploaded to ${args.remotePath}` };
        break;
      }

      case 'ssh_download': {
        const downloadResult = await fileOps.downloadFile(
          args.alias as string,
          args.remotePath as string,
          args.localPath as string
        );
        result = { ...downloadResult, message: `Downloaded to ${args.localPath}` };
        break;
      }

      case 'ssh_read_file': {
        const readResult = await fileOps.readFile(
          args.alias as string,
          args.remotePath as string,
          args.maxBytes as number | undefined
        );
        result = { success: true, ...readResult };
        break;
      }

      case 'ssh_write_file': {
        const writeResult = await fileOps.writeFile(
          args.alias as string,
          args.remotePath as string,
          args.content as string,
          args.append as boolean | undefined
        );
        result = writeResult;
        break;
      }

      case 'ssh_list_dir': {
        const files = await fileOps.listDir(
          args.alias as string,
          args.remotePath as string,
          args.showHidden as boolean | undefined
        );
        result = {
          success: true,
          path: args.remotePath,
          count: files.length,
          files,
        };
        break;
      }

      case 'ssh_file_info': {
        const info = await fileOps.getFileInfo(
          args.alias as string,
          args.remotePath as string
        );
        result = { success: true, ...info };
        break;
      }

      case 'ssh_mkdir': {
        const success = await fileOps.mkdir(
          args.alias as string,
          args.remotePath as string,
          args.recursive as boolean | undefined
        );
        result = { success, path: args.remotePath };
        break;
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error: any) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: false,
              error: error.message || String(error),
            },
            null,
            2
          ),
        },
      ],
      isError: true,
    };
  }
});

// 启动服务器
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('SSH MCP Pro server started');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
