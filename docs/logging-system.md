# Mitii AI Agent Logging System

## Overview

The Mitii AI agent uses a structured logging system to record session activities for debugging, analysis, and post-hoc evaluation. All logs are stored in JSONL (JSON Lines) format in the workspace-specific `.mitii/logs/` directory.

## File Structure

Logs are stored in the following location:
```
<workspace>/.mitii/logs/<local-time>-<sessionId>.jsonl
```

Where:
- `<workspace>` is the current working directory of the agent
- `<local-time>` is a timestamp in format `YYYY-MM-DD_HH-MM-SS` 
- `<sessionId>` is a unique identifier for the session

## JSONL Format

Each log entry is a single JSON object on its own line in the file. The structure includes:

```json
{
  "ts": 1700000000000,
  "time": "2023-11-15T10:00:00.000Z",
  "sessionId": "session-12345",
  "type": "user_message",
  "message": "Hello there",
  "data": {
    "content": "Hello there"
  }
}
```

### Required Fields
- `ts`: Unix timestamp of when the event occurred
- `time`: ISO formatted timestamp 
- `sessionId`: Unique identifier for the session
- `type`: Type of event (see below)
- `message`: Human-readable description of the event

### Optional Fields
- `data`: Additional structured data related to the event

## SessionLogEvent Types

The logging system supports 21+ event types:

```typescript
export type SessionLogEventType =
  | 'session_start'
  | 'session_end'
  | 'user_message'
  | 'assistant_message'
  | 'tool_start'
  | 'tool_end'
  | 'subagent_start'
  | 'subagent_end'
  | 'approval_request'
  | 'approval_decision'
  | 'plan_created'
  | 'plan_step'
  | 'context_pack'
  | 'token_usage'
  | 'process_start'
  | 'process_end'
  | 'timing'
  | 'error'
  | 'info'
  | 'workspace_resolved'
  | 'index_start'
  | 'index_complete'
  | 'turn_complete'
  | 'ui_trace'
  | 'microtask_context'
  | 'audit_export';
```

### Event Type Descriptions

- **session_start**: Agent session begins
- **session_end**: Agent session ends  
- **user_message**: User sends a message to the agent
- **assistant_message**: Agent responds to user
- **tool_start**: Tool execution begins
- **tool_end**: Tool execution completes
- **subagent_start**: Sub-agent execution begins
- **subagent_end**: Sub-agent execution completes
- **approval_request**: Approval requested from user
- **approval_decision**: User makes approval decision
- **plan_created**: Execution plan created
- **plan_step**: Plan step executed
- **context_pack**: Context pack loaded
- **token_usage**: Token usage statistics
- **process_start**: Process execution begins
- **process_end**: Process execution completes
- **timing**: Timing information for operations
- **error**: Error occurred during execution
- **info**: General informational message
- **workspace_resolved**: Workspace resolved and configured
- **index_start**: Indexing operation begins
- **index_complete**: Indexing operation completes
- **turn_complete**: Conversation turn completed
- **ui_trace**: UI trace information
- **microtask_context**: Microtask context information
- **audit_export**: Audit export operation

## Security and Privacy Measures

### Append-Only Mode
The logging system uses append-only file mode (`appendFileSync`) to prevent accidental overwrites.

### Directory Creation
Directories are automatically created recursively using `{ recursive: true }` to ensure the log path exists before writing.

### Secret Redaction
Sensitive information is automatically redacted from logs:
- API keys, passwords, tokens are removed or masked
- Token usage metrics are preserved for analysis
- No sensitive data is written to log files

### Workspace Isolation
Each workspace maintains its own isolated logging directory structure, preventing cross-contamination between different projects.

## Access Control and Security

### Why Specific Log Files Cannot Be Accessed

Several factors can prevent access to specific JSONL log files:

1. **Missing Directory Structure**: The `.mitii` directory may not exist in the workspace
2. **File Permissions**: Process may lack write permissions to the workspace directory  
3. **Workspace Path Issues**: Invalid or non-existent workspace paths passed to logging system
4. **Process Isolation**: In sandboxed environments (VS Code extensions), file access may be restricted by security policies
5. **Session Context**: Log files are only created when a session is active

### Error Handling

The logging system implements graceful error handling:
- File operations that fail do not crash the execution
- Errors are logged internally but execution continues
- The system attempts to create directories recursively before writing
- Path validation ensures safe construction using `join()`

## Troubleshooting

### Common Issues and Solutions

1. **"No such file or directory" errors**:
   - Ensure the workspace directory exists and is accessible
   - Check that the process has write permissions to the workspace

2. **Permission denied errors**:
   - Verify file system permissions on the workspace directory
   - Run with appropriate user privileges if needed

3. **Log files not appearing**:
   - Confirm that logging is enabled in the configuration
   - Ensure a valid session ID is being used
   - Check that the agent has started and is actively running

### Verification Commands

To verify the logging system is working:

```bash
# Check if logs directory exists
ls -la <workspace>/.mitii/logs/

# View recent log files
find <workspace>/.mitii/logs/ -name "*.jsonl" -type f -mtime -1 | head -5

# Check file permissions
ls -la <workspace>/.mitii/
```

## Implementation Details

The logging system is implemented in `SessionLogService.ts` and uses:
- Node.js `fs` operations (`appendFileSync`, `mkdirSync`)
- Path joining with `path.join()` for safe path construction
- Recursive directory creation with `{ recursive: true }`
- Automatic timestamp generation for unique filenames
- Session ID tracking for log file identification

The system is designed to be lightweight and non-intrusive, with minimal performance impact on agent execution.