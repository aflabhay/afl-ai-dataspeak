/**
 * frontend/components/MessageBubble.jsx
 */
export default function MessageBubble({ role, content, aiProvider, timestamp }) {
  const isUser  = role === 'user';
  const isError = role === 'error';

  // BigQuery TIMESTAMP columns come back as "2024-01-15 10:30:00+00:00"
  // (space instead of T, +00:00 suffix) which fails in Safari.
  // Normalise to ISO 8601 before parsing.
  function parseTs(ts) {
    if (!ts) return null;
    const iso = String(ts).trim().replace(' ', 'T').replace('+00:00', 'Z').replace(' UTC', 'Z');
    const d   = new Date(iso);
    return isNaN(d.getTime()) ? null : d;
  }

  const parsed    = parseTs(timestamp);
  const timeLabel = parsed
    ? parsed.toLocaleString(undefined, {
        month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    : null;

  if (isError) {
    return (
      <div className="message-row error">
        <div className="bubble error">{content}</div>
      </div>
    );
  }

  return (
    <div className={`message-row ${role}`}>
      <div className={`avatar ${role}`}>
        {isUser ? '👤' : '✦'}
      </div>

      <div className="message-body">
        <div className="message-meta">
          {isUser ? 'You' : (
            <>
              AIDA
              {aiProvider && <span className="meta-provider">· {aiProvider}</span>}
            </>
          )}
          {timeLabel && <span className="meta-timestamp">{timeLabel}</span>}
        </div>
        <div className={`bubble ${role}`}>{content}</div>
      </div>
    </div>
  );
}
