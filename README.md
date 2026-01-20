# MCP-SSH

A comprehensive SSH MCP Server for AI assistants (Claude, Cursor, Windsurf, etc.)

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-green.svg)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-compatible-purple.svg)](https://modelcontextprotocol.io/)

## Features

- **Multiple Authentication**: Password, SSH key, SSH agent
- **Connection Management**: Connection pooling, keepalive, auto-reconnect
- **Session Persistence**: Sessions info saved for reconnection
- **Command Execution**:
  - Basic exec with timeout
  - PTY mode (for interactive commands like `top`, `htop`)
  - `sudo` execution
  - `su` (switch user) execution - *run commands as different user*
  - Batch execution
- **File Operations**: Upload, download, read, write, list directory (via SFTP)
- **Environment Configuration**: LANG, LC_ALL, custom env vars
- **Jump Host Support**: Connect through bastion hosts

## Compatible Clients

| Client | Status |
|--------|--------|
| Claude Code | ✅ |
| Claude Desktop | ✅ |
| Cursor | ✅ |
| Windsurf | ✅ |
| Continue.dev | ✅ |
| Cline | ✅ |
| Any MCP-compatible client | ✅ |

## Installation

```bash
git clone https://github.com/Pyrokine/mcp-ssh.git
cd mcp-ssh
npm install
npm run build
```

## Configuration

### Claude Code

```bash
claude mcp add ssh -- node /path/to/mcp-ssh/dist/index.js
```

### Claude Desktop / Other Clients

Add to your MCP settings (e.g., `~/.claude/settings.json` or client-specific config):

```json
{
  "mcpServers": {
    "ssh": {
      "command": "node",
      "args": ["/path/to/mcp-ssh/dist/index.js"]
    }
  }
}
```

## Available Tools (17 tools)

### Connection Management

| Tool | Description |
|------|-------------|
| `ssh_connect` | Establish SSH connection with keepalive |
| `ssh_disconnect` | Close connection |
| `ssh_list_sessions` | List active sessions |
| `ssh_reconnect` | Reconnect a disconnected session |

### Command Execution

| Tool | Description |
|------|-------------|
| `ssh_exec` | Execute command (supports PTY mode) |
| `ssh_exec_as_user` | Execute as different user (via `su`) |
| `ssh_exec_sudo` | Execute with `sudo` |
| `ssh_exec_batch` | Execute multiple commands sequentially |
| `ssh_quick_exec` | One-shot: connect, execute, disconnect |

### File Operations

| Tool | Description |
|------|-------------|
| `ssh_upload` | Upload local file to remote server |
| `ssh_download` | Download remote file to local |
| `ssh_read_file` | Read remote file content |
| `ssh_write_file` | Write content to remote file |
| `ssh_list_dir` | List remote directory contents |
| `ssh_file_info` | Get file/directory metadata |
| `ssh_mkdir` | Create remote directory |

## Usage Examples

### Basic: Connect and Execute

```
1. ssh_connect(host="192.168.1.100", user="root", password="xxx", alias="myserver")
2. ssh_exec(alias="myserver", command="ls -la /home")
3. ssh_disconnect(alias="myserver")
```

### Switch User Execution (su)

Perfect for scenarios where you SSH as root but need to run commands as another user:

```
1. ssh_connect(host="192.168.1.100", user="root", password="xxx", alias="server")
2. ssh_exec_as_user(alias="server", command="whoami", targetUser="appuser")
   // Output: appuser
```

### Interactive Commands (PTY mode)

For commands that need a terminal:

```
ssh_exec(alias="server", command="top -b -n 1", pty=true)
```

### With Environment Variables

```
ssh_connect(
  host="192.168.1.100",
  user="root",
  password="xxx",
  env={"LANG": "en_US.UTF-8", "LC_ALL": "en_US.UTF-8"}
)
```

### Quick One-shot Execution

No need to manage connections for single commands:

```
ssh_quick_exec(
  host="192.168.1.100",
  user="root",
  password="xxx",
  command="uptime"
)
```

### File Operations

```
// Upload
ssh_upload(alias="server", localPath="/tmp/config.json", remotePath="/etc/app/config.json")

// Download
ssh_download(alias="server", remotePath="/var/log/app.log", localPath="/tmp/app.log")

// Read file content
ssh_read_file(alias="server", remotePath="/etc/hosts")
```

## Configuration Options

### Connection Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `host` | string | *required* | Server address |
| `user` | string | *required* | Username |
| `password` | string | - | Password authentication |
| `keyPath` | string | - | Path to SSH private key |
| `port` | number | 22 | SSH port |
| `alias` | string | auto-generated | Connection alias for reference |
| `env` | object | - | Environment variables |
| `keepaliveInterval` | number | 30000 | Keepalive interval in ms |

### Exec Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `timeout` | number | 30000 | Command timeout in ms |
| `cwd` | string | - | Working directory |
| `env` | object | - | Additional environment variables |
| `pty` | boolean | false | Enable PTY mode for interactive commands |

## Project Structure

```
mcp-ssh/
├── src/
│   ├── index.ts           # MCP Server entry, tool definitions
│   ├── session-manager.ts # Connection pool, exec, keepalive
│   ├── file-ops.ts        # SFTP file operations
│   └── types.ts           # TypeScript type definitions
├── dist/                  # Compiled JavaScript
├── package.json
├── tsconfig.json
└── README.md
```

## Roadmap

- [ ] Port forwarding (local/remote tunnels)
- [ ] Streaming output for long-running commands
- [ ] Command history and audit logging
- [ ] Multi-host parallel execution
- [ ] SSH config file (~/.ssh/config) auto-discovery

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Related Projects

- [Model Context Protocol](https://modelcontextprotocol.io/) - The MCP specification
- [MCP Servers](https://github.com/modelcontextprotocol/servers) - Official MCP server implementations
