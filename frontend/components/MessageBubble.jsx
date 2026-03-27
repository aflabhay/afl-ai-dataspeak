/**
 * frontend/components/MessageBubble.jsx
 * Shows a single chat message (user, assistant, or error).
 */
export default function MessageBubble({ role, content, aiProvider }) {
  const isUser      = role === 'user';
  const isError     = role === 'error';
  const providerTag = aiProvider === 'openai' ? '🤖 GPT-4o-mini' : '🤖 Claude';

  return (
    <div className={`message ${role}`}>
      <div className="message-meta">
        {isUser  ? '👤 You' : isError ? '⚠️ Error' : providerTag}
      </div>
      <div className="message-content">
        {content}
      </div>
    </div>
  );
}
