/**
 * frontend/components/FeedbackBar.jsx
 * Thumbs up/down rating bar shown below each assistant response.
 * Supports pre-populated state (from history) and re-rating.
 */
import { useState } from 'react';
import { useUser }  from '../lib/UserContext';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export default function FeedbackBar({ message, source, dataset, sessionId, initialRating = null }) {
  const { getAuthHeaders } = useUser();
  const [rating,    setRating]    = useState(initialRating);
  const [showInput, setShowInput] = useState(false);
  const [comment,   setComment]   = useState('');
  const [saving,    setSaving]    = useState(false);
  const [confirmed, setConfirmed] = useState(!!initialRating);

  async function submit(r, userComment = '') {
    setSaving(true);
    try {
      const authHeaders = await getAuthHeaders();
      await fetch(`${API_URL}/api/feedback`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          rating:      r,
          turnId:      message.turnId      || null,
          question:    message.question,
          sql:         message.sql         || null,
          explanation: message.content     || null,
          aiProvider:  message.aiProvider  || null,
          tablesUsed:  message.tablesUsed  || [],
          source,
          dataset,
          rowCount:    message.rowCount    ?? null,
          executionMs: message.executionMs ?? null,
          bqCost:      message.costInfo?.estimatedCost || null,
          aiCost:      message.aiCost?.estimatedCost   || null,
          userComment: userComment || null,
          sessionId:   sessionId   || null,
        }),
      });
      setRating(r);
      setConfirmed(true);
    } catch {
      // fail silently — feedback is non-critical
    } finally {
      setSaving(false);
    }
  }

  function handleThumb(r) {
    // Same thumb clicked again — deselect / allow changing
    if (r === rating) {
      setRating(null);
      setConfirmed(false);
      setShowInput(false);
      return;
    }
    setConfirmed(false);
    if (r === 'up') {
      setShowInput(false);
      submit('up');
    } else {
      setRating('down');
      setShowInput(true);
    }
  }

  function handleSubmitComment() {
    submit('down', comment);
    setShowInput(false);
    setComment('');
  }

  return (
    <div className="feedback-bar">
      <span className="feedback-label">
        {confirmed ? (rating === 'up' ? '👍 Marked helpful' : '👎 Feedback recorded') : 'Was this helpful?'}
      </span>

      <button
        className={`thumb-btn up ${rating === 'up' ? 'active' : ''}`}
        onClick={() => handleThumb('up')}
        disabled={saving}
        title={rating === 'up' ? 'Remove helpful rating' : 'Mark as helpful'}
      >👍</button>

      <button
        className={`thumb-btn down ${rating === 'down' ? 'active' : ''}`}
        onClick={() => handleThumb('down')}
        disabled={saving}
        title={rating === 'down' ? 'Remove unhelpful rating' : 'Mark as unhelpful'}
      >👎</button>

      {showInput && (
        <div className="feedback-comment">
          <input
            type="text"
            className="feedback-input"
            placeholder="What was wrong? (optional)"
            value={comment}
            onChange={e => setComment(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSubmitComment()}
            autoFocus
          />
          <button className="feedback-send" onClick={handleSubmitComment} disabled={saving}>
            {saving ? '…' : 'Send'}
          </button>
          <button className="feedback-skip" onClick={() => { submit('down'); setShowInput(false); }}>
            Skip
          </button>
        </div>
      )}
    </div>
  );
}
