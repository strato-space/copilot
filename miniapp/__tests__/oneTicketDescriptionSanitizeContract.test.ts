import { sanitizeTicketDescriptionHtml } from '../src/components/OneTicket';

describe('OneTicket description sanitization contract', () => {
    it('drops dangerous html while keeping safe formatting and links', () => {
        const sanitized = sanitizeTicketDescriptionHtml(`
            <div>Safe</div>
            <img src="https://cdn.example.com/task.png" onerror="alert('xss')" />
            <a href="mailto:user@example.com">mail</a>
            <a href="javascript:alert('xss')">bad</a>
            <a href="//evil.example.com" target="_blank">proto</a>
            <script>alert('xss')</script>
        `);

        expect(sanitized).toContain('<div>Safe</div>');
        expect(sanitized).toContain('src="https://cdn.example.com/task.png"');
        expect(sanitized).toContain('href="mailto:user@example.com"');
        expect(sanitized).toContain('rel="noopener noreferrer"');

        expect(sanitized).not.toContain('onerror=');
        expect(sanitized).not.toContain('javascript:');
        expect(sanitized).not.toContain('href="//');
        expect(sanitized).not.toContain('<script');
    });

    it('returns empty string for empty description', () => {
        expect(sanitizeTicketDescriptionHtml()).toBe('');
        expect(sanitizeTicketDescriptionHtml(null)).toBe('');
        expect(sanitizeTicketDescriptionHtml('')).toBe('');
    });
});
