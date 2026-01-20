/**
 * SSH Session Manager - 连接池管理
 *
 * 功能：
 * - 连接池复用
 * - 心跳保持
 * - 自动重连
 * - 会话持久化
 */

import { Client, ClientChannel, ConnectConfig, SFTPWrapper } from 'ssh2';
import * as fs from 'fs';
import * as path from 'path';
import {
  SSHConnectionConfig,
  SSHSessionInfo,
  ExecOptions,
  ExecResult,
  PersistedSession
} from './types.js';

interface SSHSession {
  client: Client;
  config: SSHConnectionConfig;
  connectedAt: number;
  lastUsedAt: number;
  reconnectAttempts: number;
}

export class SessionManager {
  private sessions: Map<string, SSHSession> = new Map();
  private persistPath: string;
  private defaultKeepaliveInterval = 30000;  // 30秒
  private defaultKeepaliveCountMax = 3;
  private defaultTimeout = 30000;  // 30秒
  private maxReconnectAttempts = 3;

  constructor(persistPath?: string) {
    this.persistPath = persistPath || path.join(
      process.env.HOME || '/tmp',
      '.ssh-mcp-pro',
      'sessions.json'
    );
    this.ensurePersistDir();
  }

  private ensurePersistDir(): void {
    const dir = path.dirname(this.persistPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * 生成连接别名
   */
  private generateAlias(config: SSHConnectionConfig): string {
    return config.alias || `${config.username}@${config.host}:${config.port}`;
  }

  /**
   * 建立 SSH 连接
   */
  async connect(config: SSHConnectionConfig): Promise<string> {
    const alias = this.generateAlias(config);

    // 检查是否已有活跃连接
    const existing = this.sessions.get(alias);
    if (existing && this.isAlive(existing)) {
      existing.lastUsedAt = Date.now();
      return alias;
    }

    const client = new Client();

    // 构建连接配置
    const connectConfig: ConnectConfig = {
      host: config.host,
      port: config.port || 22,
      username: config.username,
      readyTimeout: config.readyTimeout || this.defaultTimeout,
      keepaliveInterval: config.keepaliveInterval || this.defaultKeepaliveInterval,
      keepaliveCountMax: config.keepaliveCountMax || this.defaultKeepaliveCountMax,
    };

    // 认证方式
    if (config.password) {
      connectConfig.password = config.password;
    }
    if (config.privateKeyPath) {
      connectConfig.privateKey = fs.readFileSync(config.privateKeyPath);
    }
    if (config.privateKey) {
      connectConfig.privateKey = config.privateKey;
    }
    if (config.passphrase) {
      connectConfig.passphrase = config.passphrase;
    }

    // 跳板机支持
    if (config.jumpHost) {
      const jumpAlias = await this.connect(config.jumpHost);
      const jumpSession = this.sessions.get(jumpAlias);
      if (jumpSession) {
        // 通过跳板机建立连接
        const stream = await this.forwardConnection(
          jumpSession.client,
          config.host,
          config.port || 22
        );
        connectConfig.sock = stream;
      }
    }

    return new Promise((resolve, reject) => {
      client.on('ready', () => {
        const session: SSHSession = {
          client,
          config,
          connectedAt: Date.now(),
          lastUsedAt: Date.now(),
          reconnectAttempts: 0,
        };
        this.sessions.set(alias, session);
        this.persistSessions();
        resolve(alias);
      });

      client.on('error', (err) => {
        reject(new Error(`SSH connection failed: ${err.message}`));
      });

      client.on('close', () => {
        // 自动重连逻辑
        const session = this.sessions.get(alias);
        if (session && session.reconnectAttempts < this.maxReconnectAttempts) {
          session.reconnectAttempts++;
          setTimeout(() => {
            this.reconnect(alias).catch(() => {});
          }, 5000);  // 5秒后重连
        }
      });

      client.connect(connectConfig);
    });
  }

  /**
   * 通过跳板机转发连接
   */
  private forwardConnection(
    jumpClient: Client,
    targetHost: string,
    targetPort: number
  ): Promise<ClientChannel> {
    return new Promise((resolve, reject) => {
      jumpClient.forwardOut(
        '127.0.0.1',
        0,
        targetHost,
        targetPort,
        (err, stream) => {
          if (err) reject(err);
          else resolve(stream);
        }
      );
    });
  }

  /**
   * 检查连接是否存活
   */
  private isAlive(session: SSHSession): boolean {
    try {
      // ssh2 没有直接的 isConnected 方法，通过检查 client 状态
      return session.client && (session.client as any)._sock?.readable;
    } catch {
      return false;
    }
  }

  /**
   * 重新连接
   */
  async reconnect(alias: string): Promise<void> {
    const session = this.sessions.get(alias);
    if (!session) {
      throw new Error(`Session ${alias} not found`);
    }

    try {
      session.client.end();
    } catch {}

    await this.connect(session.config);
  }

  /**
   * 断开连接
   */
  disconnect(alias: string): boolean {
    const session = this.sessions.get(alias);
    if (session) {
      try {
        session.client.end();
      } catch {}
      this.sessions.delete(alias);
      this.persistSessions();
      return true;
    }
    return false;
  }

  /**
   * 断开所有连接
   */
  disconnectAll(): void {
    for (const alias of this.sessions.keys()) {
      this.disconnect(alias);
    }
  }

  /**
   * 获取会话
   */
  getSession(alias: string): SSHSession {
    const session = this.sessions.get(alias);
    if (!session) {
      throw new Error(`Session '${alias}' not found. Use ssh_connect first.`);
    }
    if (!this.isAlive(session)) {
      throw new Error(`Session '${alias}' is disconnected. Use ssh_connect to reconnect.`);
    }
    session.lastUsedAt = Date.now();
    return session;
  }

  /**
   * 列出所有会话
   */
  listSessions(): SSHSessionInfo[] {
    const result: SSHSessionInfo[] = [];
    for (const [alias, session] of this.sessions) {
      result.push({
        alias,
        host: session.config.host,
        port: session.config.port || 22,
        username: session.config.username,
        connected: this.isAlive(session),
        connectedAt: session.connectedAt,
        lastUsedAt: session.lastUsedAt,
        env: session.config.env,
      });
    }
    return result;
  }

  /**
   * 执行命令
   */
  async exec(
    alias: string,
    command: string,
    options: ExecOptions = {}
  ): Promise<ExecResult> {
    const session = this.getSession(alias);
    const startTime = Date.now();

    // 构建完整命令（包含环境变量）
    let fullCommand = command;
    const env = { ...session.config.env, ...options.env };

    if (Object.keys(env).length > 0) {
      const envStr = Object.entries(env)
        .map(([k, v]) => `export ${k}="${v}"`)
        .join('; ');
      fullCommand = `${envStr}; ${command}`;
    }

    if (options.cwd) {
      fullCommand = `cd "${options.cwd}" && ${fullCommand}`;
    }

    return new Promise((resolve, reject) => {
      const timeout = options.timeout || this.defaultTimeout;
      let timeoutId: NodeJS.Timeout | null = null;
      let stdout = '';
      let stderr = '';

      const execOptions: any = {};

      // PTY 模式
      if (options.pty) {
        execOptions.pty = {
          rows: options.rows || 24,
          cols: options.cols || 80,
          term: options.term || 'xterm-256color',
        };
      }

      session.client.exec(fullCommand, execOptions, (err, stream) => {
        if (err) {
          reject(new Error(`Exec failed: ${err.message}`));
          return;
        }

        // 设置超时
        timeoutId = setTimeout(() => {
          stream.close();
          reject(new Error(`Command timed out after ${timeout}ms`));
        }, timeout);

        stream.on('close', (code: number) => {
          if (timeoutId) clearTimeout(timeoutId);
          resolve({
            success: code === 0,
            stdout,
            stderr,
            exitCode: code,
            duration: Date.now() - startTime,
          });
        });

        stream.on('data', (data: Buffer) => {
          stdout += data.toString('utf-8');
        });

        stream.stderr.on('data', (data: Buffer) => {
          stderr += data.toString('utf-8');
        });
      });
    });
  }

  /**
   * 以其他用户身份执行命令
   */
  async execAsUser(
    alias: string,
    command: string,
    targetUser: string,
    options: ExecOptions = {}
  ): Promise<ExecResult> {
    // 转义单引号
    const escapedCommand = command.replace(/'/g, "'\\''");
    const suCommand = `su - ${targetUser} -c '${escapedCommand}'`;
    return this.exec(alias, suCommand, options);
  }

  /**
   * 使用 sudo 执行命令
   */
  async execSudo(
    alias: string,
    command: string,
    sudoPassword?: string,
    options: ExecOptions = {}
  ): Promise<ExecResult> {
    let sudoCommand: string;
    if (sudoPassword) {
      // 通过 stdin 传递密码
      sudoCommand = `echo '${sudoPassword}' | sudo -S ${command}`;
    } else {
      sudoCommand = `sudo ${command}`;
    }
    return this.exec(alias, sudoCommand, options);
  }

  /**
   * 获取 SFTP 客户端
   */
  getSftp(alias: string): Promise<SFTPWrapper> {
    const session = this.getSession(alias);
    return new Promise((resolve, reject) => {
      session.client.sftp((err, sftp) => {
        if (err) reject(err);
        else resolve(sftp);
      });
    });
  }

  /**
   * 持久化会话信息
   */
  private persistSessions(): void {
    const data: PersistedSession[] = [];
    for (const [alias, session] of this.sessions) {
      // 不保存敏感信息（密码、密钥）
      data.push({
        alias,
        host: session.config.host,
        port: session.config.port || 22,
        username: session.config.username,
        connectedAt: session.connectedAt,
        env: session.config.env,
      });
    }
    try {
      fs.writeFileSync(this.persistPath, JSON.stringify(data, null, 2));
    } catch (e) {
      // 忽略写入错误
    }
  }

  /**
   * 加载持久化的会话信息（仅用于显示，不自动重连）
   */
  loadPersistedSessions(): PersistedSession[] {
    try {
      if (fs.existsSync(this.persistPath)) {
        return JSON.parse(fs.readFileSync(this.persistPath, 'utf-8'));
      }
    } catch {}
    return [];
  }
}

// 全局单例
export const sessionManager = new SessionManager();
