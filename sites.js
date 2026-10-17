// Per-site page selectors. These sites change their markup often — if a site
// stops working, run `npm run check` and update the selector here.
export const SITES = {
  chatgpt: {
    name: 'ChatGPT',
    host: 'chatgpt.com',
    newChatUrl: 'https://chatgpt.com/',
    input: '#prompt-textarea, div[contenteditable="true"][role="textbox"]',
    send: 'button[data-testid="send-button"], button[aria-label="Send"]',
    stop: 'button[data-testid="stop-button"], button[aria-label="Stop"]',
    response: '[data-message-author-role="assistant"], [data-content-search-unit-key$=":assistant"]',
  },
  gemini: {
    name: 'Gemini',
    host: 'gemini.google.com',
    newChatUrl: 'https://gemini.google.com/app',
    input: 'rich-textarea .ql-editor',
    send: 'button[aria-label="Send message"]',
    stop: 'button[aria-label="Stop response"]',
    response: 'model-response message-content',
  },
};
