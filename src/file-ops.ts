/**
 * SSH File Operations - 文件操作
 */

import * as fs from 'fs';
import * as path from 'path';
import { SFTPWrapper, Stats } from 'ssh2';
import { sessionManager } from './session-manager.js';
import { FileInfo, TransferProgress } from './types.js';

/**
 * 上传文件
 */
export async function uploadFile(
  alias: string,
  localPath: string,
  remotePath: string,
  onProgress?: (progress: TransferProgress) => void
): Promise<{ success: boolean; size: number }> {
  if (!fs.existsSync(localPath)) {
    throw new Error(`Local file not found: ${localPath}`);
  }

  const sftp = await sessionManager.getSftp(alias);
  const stats = fs.statSync(localPath);
  const totalSize = stats.size;

  return new Promise((resolve, reject) => {
    const readStream = fs.createReadStream(localPath);
    const writeStream = sftp.createWriteStream(remotePath);

    let transferred = 0;

    readStream.on('data', (chunk: Buffer) => {
      transferred += chunk.length;
      if (onProgress) {
        onProgress({
          transferred,
          total: totalSize,
          percent: Math.round((transferred / totalSize) * 100),
        });
      }
    });

    writeStream.on('close', () => {
      sftp.end();
      resolve({ success: true, size: totalSize });
    });

    writeStream.on('error', (err: Error) => {
      sftp.end();
      reject(err);
    });

    readStream.pipe(writeStream);
  });
}

/**
 * 下载文件
 */
export async function downloadFile(
  alias: string,
  remotePath: string,
  localPath: string,
  onProgress?: (progress: TransferProgress) => void
): Promise<{ success: boolean; size: number }> {
  const sftp = await sessionManager.getSftp(alias);

  // 获取远程文件大小
  const stats = await new Promise<Stats>((resolve, reject) => {
    sftp.stat(remotePath, (err, stats) => {
      if (err) reject(err);
      else resolve(stats);
    });
  });
  const totalSize = stats.size;

  // 确保本地目录存在
  const localDir = path.dirname(localPath);
  if (!fs.existsSync(localDir)) {
    fs.mkdirSync(localDir, { recursive: true });
  }

  return new Promise((resolve, reject) => {
    const readStream = sftp.createReadStream(remotePath);
    const writeStream = fs.createWriteStream(localPath);

    let transferred = 0;

    readStream.on('data', (chunk: Buffer) => {
      transferred += chunk.length;
      if (onProgress) {
        onProgress({
          transferred,
          total: totalSize,
          percent: Math.round((transferred / totalSize) * 100),
        });
      }
    });

    writeStream.on('close', () => {
      sftp.end();
      resolve({ success: true, size: totalSize });
    });

    readStream.on('error', (err: Error) => {
      sftp.end();
      reject(err);
    });

    readStream.pipe(writeStream);
  });
}

/**
 * 读取远程文件内容
 */
export async function readFile(
  alias: string,
  remotePath: string,
  maxBytes: number = 1024 * 1024  // 默认最大 1MB
): Promise<{ content: string; size: number; truncated: boolean }> {
  const sftp = await sessionManager.getSftp(alias);

  // 获取文件大小
  const stats = await new Promise<Stats>((resolve, reject) => {
    sftp.stat(remotePath, (err, stats) => {
      if (err) reject(err);
      else resolve(stats);
    });
  });

  const actualSize = stats.size;
  const readSize = Math.min(actualSize, maxBytes);
  const truncated = actualSize > maxBytes;

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalRead = 0;

    const readStream = sftp.createReadStream(remotePath, {
      start: 0,
      end: readSize - 1,
    });

    readStream.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
      totalRead += chunk.length;
    });

    readStream.on('end', () => {
      sftp.end();
      const content = Buffer.concat(chunks).toString('utf-8');
      resolve({
        content,
        size: actualSize,
        truncated,
      });
    });

    readStream.on('error', (err: Error) => {
      sftp.end();
      reject(err);
    });
  });
}

/**
 * 写入远程文件
 */
export async function writeFile(
  alias: string,
  remotePath: string,
  content: string,
  append: boolean = false
): Promise<{ success: boolean; size: number }> {
  const sftp = await sessionManager.getSftp(alias);
  const flags = append ? 'a' : 'w';

  return new Promise((resolve, reject) => {
    const writeStream = sftp.createWriteStream(remotePath, { flags });

    writeStream.on('close', () => {
      sftp.end();
      resolve({ success: true, size: content.length });
    });

    writeStream.on('error', (err: Error) => {
      sftp.end();
      reject(err);
    });

    writeStream.write(content);
    writeStream.end();
  });
}

/**
 * 列出目录内容
 */
export async function listDir(
  alias: string,
  remotePath: string,
  showHidden: boolean = false
): Promise<FileInfo[]> {
  const sftp = await sessionManager.getSftp(alias);

  return new Promise((resolve, reject) => {
    sftp.readdir(remotePath, (err, list) => {
      if (err) {
        sftp.end();
        reject(err);
        return;
      }

      const files: FileInfo[] = list
        .filter((item) => showHidden || !item.filename.startsWith('.'))
        .map((item) => ({
          name: item.filename,
          path: path.posix.join(remotePath, item.filename),
          size: item.attrs.size,
          isDirectory: (item.attrs.mode & 0o40000) !== 0,
          isFile: (item.attrs.mode & 0o100000) !== 0,
          isSymlink: (item.attrs.mode & 0o120000) !== 0,
          permissions: formatPermissions(item.attrs.mode),
          owner: item.attrs.uid,
          group: item.attrs.gid,
          mtime: new Date(item.attrs.mtime * 1000),
          atime: new Date(item.attrs.atime * 1000),
        }))
        .sort((a, b) => {
          // 目录在前
          if (a.isDirectory !== b.isDirectory) {
            return a.isDirectory ? -1 : 1;
          }
          return a.name.localeCompare(b.name);
        });

      sftp.end();
      resolve(files);
    });
  });
}

/**
 * 获取文件信息
 */
export async function getFileInfo(
  alias: string,
  remotePath: string
): Promise<FileInfo> {
  const sftp = await sessionManager.getSftp(alias);

  return new Promise((resolve, reject) => {
    sftp.stat(remotePath, (err, stats) => {
      sftp.end();

      if (err) {
        reject(err);
        return;
      }

      resolve({
        name: path.posix.basename(remotePath),
        path: remotePath,
        size: stats.size,
        isDirectory: (stats.mode & 0o40000) !== 0,
        isFile: (stats.mode & 0o100000) !== 0,
        isSymlink: (stats.mode & 0o120000) !== 0,
        permissions: formatPermissions(stats.mode),
        owner: stats.uid,
        group: stats.gid,
        mtime: new Date(stats.mtime * 1000),
        atime: new Date(stats.atime * 1000),
      });
    });
  });
}

/**
 * 检查文件是否存在
 */
export async function fileExists(
  alias: string,
  remotePath: string
): Promise<boolean> {
  const sftp = await sessionManager.getSftp(alias);

  return new Promise((resolve) => {
    sftp.stat(remotePath, (err) => {
      sftp.end();
      resolve(!err);
    });
  });
}

/**
 * 创建目录
 */
export async function mkdir(
  alias: string,
  remotePath: string,
  recursive: boolean = false
): Promise<boolean> {
  if (recursive) {
    // 通过 exec 实现递归创建
    const result = await sessionManager.exec(alias, `mkdir -p "${remotePath}"`);
    return result.exitCode === 0;
  }

  const sftp = await sessionManager.getSftp(alias);
  return new Promise((resolve, reject) => {
    sftp.mkdir(remotePath, (err) => {
      sftp.end();
      if (err) reject(err);
      else resolve(true);
    });
  });
}

/**
 * 删除文件
 */
export async function removeFile(
  alias: string,
  remotePath: string
): Promise<boolean> {
  const sftp = await sessionManager.getSftp(alias);
  return new Promise((resolve, reject) => {
    sftp.unlink(remotePath, (err) => {
      sftp.end();
      if (err) reject(err);
      else resolve(true);
    });
  });
}

/**
 * 格式化权限字符串
 */
function formatPermissions(mode: number): string {
  const types: Record<number, string> = {
    0o40000: 'd',
    0o120000: 'l',
    0o100000: '-',
  };

  let type = '-';
  for (const [mask, char] of Object.entries(types)) {
    if ((mode & parseInt(mask)) !== 0) {
      type = char;
      break;
    }
  }

  const perms = [
    (mode & 0o400) ? 'r' : '-',
    (mode & 0o200) ? 'w' : '-',
    (mode & 0o100) ? 'x' : '-',
    (mode & 0o040) ? 'r' : '-',
    (mode & 0o020) ? 'w' : '-',
    (mode & 0o010) ? 'x' : '-',
    (mode & 0o004) ? 'r' : '-',
    (mode & 0o002) ? 'w' : '-',
    (mode & 0o001) ? 'x' : '-',
  ];

  return type + perms.join('');
}
