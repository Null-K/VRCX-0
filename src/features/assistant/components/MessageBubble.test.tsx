import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { UIMessage } from '../assistantTypes';
import { MessageBubble } from './MessageBubble';

function assistantMessage(message: Partial<UIMessage>): UIMessage {
    return {
        id: 'asst_1',
        role: 'assistant',
        text: '',
        streaming: true,
        toolCalls: [],
        ...message
    };
}

describe('MessageBubble', () => {
    it('shows pending tool calls as the tool name followed by a spinner', () => {
        const html = renderToStaticMarkup(
            <MessageBubble
                message={assistantMessage({
                    toolCalls: [
                        {
                            id: 'tool_1',
                            name: 'get_friend_profile',
                            args: '{}',
                            status: 'pending',
                            summary: '',
                            entities: []
                        }
                    ]
                })}
            />
        );

        expect(html).toContain('Get friend profile');
        expect(html).toContain('animate-spin');
        expect(html).not.toContain('Calling');
    });

    it('does not render a standalone streaming cursor while only tool calls exist', () => {
        const html = renderToStaticMarkup(
            <MessageBubble
                message={assistantMessage({
                    toolCalls: [
                        {
                            id: 'tool_1',
                            name: 'get_friend_profile',
                            args: '{}',
                            status: 'pending',
                            summary: '',
                            entities: []
                        }
                    ]
                })}
            />
        );

        expect(html).not.toContain('animate-pulse');
    });

    it('keeps the streaming cursor when assistant text is visible', () => {
        const html = renderToStaticMarkup(
            <MessageBubble
                message={assistantMessage({
                    text: 'Reading local social data'
                })}
            />
        );

        expect(html).toContain('Reading local social data');
        expect(html).toContain('animate-pulse');
    });

    it('keeps assistant text before tool calls so new tools do not push the cursor down', () => {
        const html = renderToStaticMarkup(
            <MessageBubble
                message={assistantMessage({
                    text: 'Reading local social data',
                    toolCalls: [
                        {
                            id: 'tool_1',
                            name: 'get_friend_profile',
                            args: '{}',
                            status: 'pending',
                            summary: '',
                            entities: []
                        }
                    ]
                })}
            />
        );

        expect(html.indexOf('Reading local social data')).toBeLessThan(
            html.indexOf('Get friend profile')
        );
    });
});
