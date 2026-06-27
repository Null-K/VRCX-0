import { memo } from 'react';

import { cn } from '@/lib/utils';

import type { UIMessage } from '../assistantTypes';
import { AssistantMarkdown } from './AssistantMarkdown';
import { ToolCallChip } from './ToolCallChip';

interface MessageBubbleProps {
    message: UIMessage;
}

function MessageBubbleImpl({ message }: MessageBubbleProps) {
    const isUser = message.role === 'user';
    // Markdown is parsed only once the answer is complete: parsing the whole
    // accumulating text every token is O(n²) and mid-stream markdown is half
    // broken (unterminated **, partial tables) anyway.
    const renderPlain = isUser || message.streaming;
    const hasText = message.text.length > 0;

    return (
        <div
            className={cn(
                'flex flex-col gap-1.5',
                isUser ? 'items-end' : 'items-start'
            )}
        >
            {hasText && (
                <div
                    className={cn(
                        'rounded-2xl px-3 py-2 text-sm',
                        isUser
                            ? 'bg-secondary text-secondary-foreground max-w-[85%]'
                            : 'bg-card/50 text-foreground max-w-full'
                    )}
                >
                    {renderPlain ? (
                        <span className="whitespace-pre-wrap">
                            {message.text}
                        </span>
                    ) : (
                        <AssistantMarkdown text={message.text} />
                    )}
                    {message.streaming && hasText && (
                        <span className="bg-foreground/60 ml-0.5 inline-block h-3.5 w-1.5 animate-pulse align-middle" />
                    )}
                </div>
            )}

            {message.toolCalls.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {message.toolCalls.map((call) => (
                        <ToolCallChip key={call.id} toolCall={call} />
                    ))}
                </div>
            )}

            {message.error && (
                <div className="bg-destructive/10 text-destructive rounded-md px-2 py-1 text-xs">
                    {message.error}
                </div>
            )}
        </div>
    );
}

export const MessageBubble = memo(MessageBubbleImpl);
