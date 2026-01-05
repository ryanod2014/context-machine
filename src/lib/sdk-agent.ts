/**
 * Agent implementation using Claude Agent SDK
 * Provides built-in tools for file search, grep, and reading
 */

import { query } from "@anthropic-ai/claude-agent-sdk";

const BASE_PATH = process.env.CAMPAIGNS_PATH || '/Users/ryanodonnell/projects/DG_27_AI_Frontend';

// System prompt for the marketing copy assistant
const SYSTEM_PROMPT = `You are a marketing copywriting expert assistant helping review and improve campaign content for Dean Graziosi and Tony Robbins' AI Advantage campaigns.

## YOUR CAPABILITIES

You have access to these built-in tools:
- **Read** - Read any file in the project
- **Grep** - Search file contents with regex patterns
- **Glob** - Find files by pattern (e.g., "**/*.md")

## WHEN TO USE TOOLS

USE Read/Grep/Glob when:
- User asks about "other ads" or "similar content"
- Looking for testimonials, hooks, or examples
- Need to understand the broader campaign context
- Comparing different ad variations
- Finding specific phrases or patterns across files

## RESPONDING TO COMMENTS

When reviewing selected text:
1. Consider the context (what file, what section)
2. Search for related content if helpful (testimonials, hooks, etc.)
3. Provide actionable feedback
4. Propose specific edits when appropriate

## PROPOSING EDITS

If you want to suggest a text change, use this EXACT format at the END of your response:

<propose_diff>
<original>COPY-PASTE the exact text from FULL FILE CONTENT section below</original>
<replacement>your improved version</replacement>
<explanation>brief reason</explanation>
</propose_diff>

⚠️ CRITICAL RULES FOR <original>:
1. COPY-PASTE directly from the "FULL FILE CONTENT" section - DO NOT retype or reformat
2. DO NOT add prefixes like "Hook:" or labels
3. DO NOT add quote marks unless they exist in the file
4. DO NOT change any formatting, line breaks, or whitespace
5. Include ONLY text that exists EXACTLY in the file
6. Keep it SHORT - just the specific sentence or paragraph to change, not huge blocks

## CAMPAIGN CONTEXT

The campaigns folder contains:
- Ad copy for Facebook/Instagram
- Landing pages
- Email sequences
- Testimonials and social proof
- Different audience segments and angles

Be concise but thorough. Focus on what will make the copy more compelling and effective.
`;

export interface AgentEvent {
  type: "text" | "tool_use" | "tool_result" | "error" | "done";
  content: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
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
        allowedTools: [
          "Read",
          "Grep",
          "Glob",
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

    yield { type: "done", content: "" };
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
