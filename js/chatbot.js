(function() {
  const CHAT_API = '/api/chat';
  let isOpen = false;
  let messages = [];
  let isStreaming = false;

  const stored = sessionStorage.getItem('cu-chat');
  if (stored) {
    try { messages = JSON.parse(stored); } catch {}
  }

  function saveMessages() {
    sessionStorage.setItem('cu-chat', JSON.stringify(messages));
  }

  function createWidget() {
    const container = document.createElement('div');
    container.id = 'cu-chat';
    container.innerHTML = `
      <button id="cu-chat-toggle" aria-label="Chat with us" aria-expanded="false">
        <span class="cu-chat-avatar">C</span>
        <span class="cu-chat-label">Chat</span>
        <span class="cu-chat-dot"></span>
      </button>
      <div id="cu-chat-panel" aria-hidden="true">
        <div id="cu-chat-header">
          <div id="cu-chat-header-left">
            <span class="cu-chat-header-avatar">C</span>
            <div>
              <div id="cu-chat-title">Catch Up</div>
              <div id="cu-chat-status">Online</div>
            </div>
          </div>
          <button id="cu-chat-close" aria-label="Close chat">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M4 4L14 14M14 4L4 14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div id="cu-chat-messages"></div>
        <form id="cu-chat-form">
          <input id="cu-chat-input" type="text" placeholder="Type a message..." autocomplete="off" />
          <button id="cu-chat-send" type="submit" aria-label="Send message">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M2 9L16 2L9 16L8 10L2 9Z" fill="currentColor"/></svg>
          </button>
        </form>
      </div>
    `;
    document.body.appendChild(container);

    const toggle = document.getElementById('cu-chat-toggle');
    const panel = document.getElementById('cu-chat-panel');
    const close = document.getElementById('cu-chat-close');
    const form = document.getElementById('cu-chat-form');
    const input = document.getElementById('cu-chat-input');
    const messagesEl = document.getElementById('cu-chat-messages');

    toggle.addEventListener('click', () => {
      isOpen = !isOpen;
      panel.classList.toggle('cu-chat-open', isOpen);
      panel.setAttribute('aria-hidden', String(!isOpen));
      toggle.setAttribute('aria-expanded', String(isOpen));
      toggle.classList.toggle('cu-chat-hidden', isOpen);
      if (isOpen) {
        input.focus();
        if (messages.length === 0) showGreeting();
        scrollToBottom();
      }
    });

    close.addEventListener('click', () => {
      isOpen = false;
      panel.classList.remove('cu-chat-open');
      panel.setAttribute('aria-hidden', 'true');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.classList.remove('cu-chat-hidden');
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text || isStreaming) return;
      input.value = '';
      sendMessage(text);
    });

    if (messages.length > 0) {
      messages.forEach(m => {
        if (m.role === 'user') appendUserBubble(m.content);
        else if (m.role === 'assistant') appendBotBubble(m.content);
      });
    }
  }

  function showGreeting() {
    const greeting = "Hey! I'm the Catch Up assistant. Got a project in mind, or just having a look around?";
    appendBotBubble(greeting);
    messages.push({ role: 'assistant', content: greeting });
    saveMessages();
  }

  function appendUserBubble(text) {
    const messagesEl = document.getElementById('cu-chat-messages');
    const bubble = document.createElement('div');
    bubble.className = 'cu-msg cu-msg-user';
    bubble.textContent = text;
    messagesEl.appendChild(bubble);
    scrollToBottom();
  }

  function appendBotBubble(text) {
    const messagesEl = document.getElementById('cu-chat-messages');
    const bubble = document.createElement('div');
    bubble.className = 'cu-msg cu-msg-bot';
    renderBotText(bubble, text);
    messagesEl.appendChild(bubble);
    scrollToBottom();
    return bubble;
  }

  function appendTypingIndicator() {
    const messagesEl = document.getElementById('cu-chat-messages');
    const typing = document.createElement('div');
    typing.className = 'cu-msg cu-msg-bot cu-typing';
    typing.id = 'cu-typing';
    typing.innerHTML = '<span></span><span></span><span></span>';
    messagesEl.appendChild(typing);
    scrollToBottom();
  }

  function removeTypingIndicator() {
    const typing = document.getElementById('cu-typing');
    if (typing) typing.remove();
  }

  function scrollToBottom() {
    const messagesEl = document.getElementById('cu-chat-messages');
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function renderBotText(container, text) {
    container.textContent = '';
    const parts = text.split(/(\*\*.*?\*\*|\n)/g);
    for (const part of parts) {
      if (part === '\n') {
        container.appendChild(document.createElement('br'));
      } else if (part.startsWith('**') && part.endsWith('**')) {
        const strong = document.createElement('strong');
        strong.textContent = part.slice(2, -2);
        container.appendChild(strong);
      } else if (part) {
        container.appendChild(document.createTextNode(part));
      }
    }
  }

  async function sendMessage(text) {
    appendUserBubble(text);
    messages.push({ role: 'user', content: text });
    saveMessages();

    isStreaming = true;
    const sendBtn = document.getElementById('cu-chat-send');
    const input = document.getElementById('cu-chat-input');
    sendBtn.disabled = true;
    input.disabled = true;

    appendTypingIndicator();

    try {
      const apiMessages = messages.map(m => ({
        role: m.role,
        content: m.content
      }));

      const response = await fetch(CHAT_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: apiMessages,
          page: window.location.pathname
        })
      });

      if (!response.ok) throw new Error('Chat request failed');

      removeTypingIndicator();

      let currentBubble = null;
      let fullText = '';
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;

          try {
            const data = JSON.parse(jsonStr);

            if (data.type === 'text_start' || (data.type === 'text' && !currentBubble)) {
              currentBubble = appendBotBubble('');
              fullText = '';
            }

            if (data.type === 'text' && currentBubble) {
              fullText += data.text;
              renderBotText(currentBubble, fullText);
              scrollToBottom();
            }

            if (data.type === 'lead_captured') {
              showLeadSuccess();
            }

            if (data.type === 'done') {
              if (fullText) {
                messages.push({ role: 'assistant', content: fullText });
                saveMessages();
              }
            }

            if (data.type === 'error') {
              removeTypingIndicator();
              appendBotBubble('Sorry, something went wrong. Please try again in a moment.');
            }
          } catch {}
        }
      }
    } catch (error) {
      removeTypingIndicator();
      appendBotBubble("Sorry, I couldn't connect. Please try again or use our contact form.");
    } finally {
      isStreaming = false;
      const sendBtn = document.getElementById('cu-chat-send');
      const input = document.getElementById('cu-chat-input');
      sendBtn.disabled = false;
      input.disabled = false;
      input.focus();
    }
  }

  function showLeadSuccess() {
    const messagesEl = document.getElementById('cu-chat-messages');
    const notice = document.createElement('div');
    notice.className = 'cu-lead-notice';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('fill', 'none');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M4 8L7 11L12 5');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
    notice.appendChild(svg);
    notice.appendChild(document.createTextNode(' Details captured'));
    messagesEl.appendChild(notice);
    scrollToBottom();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createWidget);
  } else {
    createWidget();
  }
})();
