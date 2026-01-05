/**
 * Agent implementation using Claude Agent SDK
 * Uses custom propose_diff tool for reliable diff proposals
 */

import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const BASE_PATH = process.env.CAMPAIGNS_PATH || '/Users/ryanodonnell/projects/DG_27_AI_Frontend';

// Store proposed diff from tool calls (per request)
let lastProposedDiff: { original: string; replacement: string; explanation: string } | undefined;

// Create MCP server with propose_diff tool
function createCommentToolsServer() {
  return createSdkMcpServer({
    name: "comment-tools",
    version: "1.0.0",
    tools: [
      tool(
        "propose_diff",
        `Propose a change to the selected text. Use this when you want to suggest an edit or improvement.

The diff will be shown to the user who can Accept (apply the change) or Reject (continue discussion).

IMPORTANT: The 'original' field must be EXACT text from the file - copy-paste it precisely.`,
        {
          original: z.string().describe("The EXACT original text from the file being replaced - copy-paste precisely"),
          replacement: z.string().describe("The new text to replace it with"),
          explanation: z.string().describe("Brief explanation of why this change improves the copy"),
        },
        async (args) => {
          lastProposedDiff = {
            original: args.original,
            replacement: args.replacement,
            explanation: args.explanation,
          };
          return {
            content: [{
              type: "text" as const,
              text: `Diff proposed successfully.`
            }],
          };
        }
      ),
    ],
  });
}

// System prompt for the marketing copy assistant
const SYSTEM_PROMPT = `You are a marketing copywriting expert assistant helping review and improve campaign content for Dean Graziosi and Tony Robbins' AI Advantage campaigns.

## YOUR CAPABILITIES

You have access to these tools:
- **Read** - Read any file in the project
- **Grep** - Search file contents with regex patterns
- **Glob** - Find files by pattern (e.g., "**/*.md")
- **propose_diff** - Suggest a text change (user can accept/reject)

## WHEN TO USE TOOLS

USE Read/Grep/Glob when:
- User asks about "other ads" or "similar content"
- Looking for testimonials, hooks, or examples
- Need to understand the broader campaign context
- Comparing different ad variations

USE propose_diff when:
- User asks you to improve/change/rewrite something
- You see an opportunity to make the copy better
- User agrees with your suggestion and wants it applied

## PROPOSING EDITS

When using propose_diff:
1. The 'original' MUST be exact text from the file - copy-paste it
2. Keep changes focused - one sentence or paragraph at a time
3. Explain why the change improves the copy

## CAMPAIGN CONTEXT

The campaigns folder contains ad copy, landing pages, email sequences, testimonials, and different audience segments.

Be concise and actionable. Focus on what makes copy more compelling.
`;

export interface AgentEvent {
  type: "text" | "tool_use" | "tool_result" | "error" | "done";
  content: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  proposedDiff?: { original: string; replacement: string; explanation: string };
}

/**
 * Stream agent responses using the Claude Agent SDK
 */
export async function* streamAgentResponse(
  userMessage: string,
  fileContext: {
    filePath: string;
    selectedText: string;
    fileContent: string;
  }
): AsyncGenerator<AgentEvent> {
  // Reset proposed diff for this request
  lastProposedDiff = undefined;

  // Create the tools server
  const toolsServer = createCommentToolsServer();

  // Build the prompt with context
  const prompt = `## CURRENT FILE
Path: ${fileContext.filePath}

## SELECTED TEXT (user is commenting on this)
"${fileContext.selectedText}"

## FULL FILE CONTENT
\`\`\`
${fileContext.fileContent}
\`\`\`

## USER'S COMMENT
${userMessage}`;

  try {
    for await (const event of query({
      prompt,
      options: {
        systemPrompt: SYSTEM_PROMPT,
        mcpServers: {
          "comment-tools": toolsServer,
        },
        allowedTools: [
          "Read",
          "Grep",
          "Glob",
          "mcp__comment-tools__propose_diff",
        ],
        workingDirectory: BASE_PATH,
        permissionMode: "acceptEdits",
        model: "claude-sonnet-4-20250514",
        maxTokens: 2000,
      },
    })) {
      if (event.type === "assistant") {
        const message = event.message;
        if (message?.content) {
          for (const block of message.content) {
            if ("text" in block && block.text) {
              yield { type: "text", content: block.text };
            } else if ("type" in block && block.type === "tool_use") {
              const toolBlock = block as { type: "tool_use"; name: string; input: Record<string, unknown> };
              yield {
                type: "tool_use",
                content: `Using ${toolBlock.name}...`,
                toolName: toolBlock.name,
                toolInput: toolBlock.input,
              };
            }
          }
        }
      } else if (event.type === "result") {
        if (event.subtype !== "success") {
          yield { type: "error", content: `Agent stopped: ${event.subtype}` };
        }
      }
    }

    // Yield done event with any proposed diff
    yield { type: "done", content: "", proposedDiff: lastProposedDiff };
  } catch (error) {
    yield {
      type: "error",
      content: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}

/**
 * Run agent and return full response (non-streaming)
 */
export async function runAgent(
  userMessage: string,
  fileContext: {
    filePath: string;
    selectedText: string;
    fileContent: string;
  }
): Promise<{ response: string; toolCalls: Array<{ name: string; input: unknown }> }> {
  let fullResponse = "";
  const toolCalls: Array<{ name: string; input: unknown }> = [];

  for await (const event of streamAgentResponse(userMessage, fileContext)) {
    if (event.type === "text") {
      fullResponse += event.content;
    } else if (event.type === "tool_use") {
      toolCalls.push({
        name: event.toolName || "unknown",
        input: event.toolInput || {},
      });
    } else if (event.type === "error") {
      fullResponse += `\n[Error: ${event.content}]\n`;
    }
  }

  return { response: fullResponse, toolCalls };
}
