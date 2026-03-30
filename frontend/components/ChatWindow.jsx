/**
 * frontend/components/ChatWindow.jsx
 */
import { useState, useRef, useEffect } from 'react';
import MessageBubble  from './MessageBubble';
import ResultsTable   from './ResultsTable';
import SqlPreview     from './SqlPreview';
import ChartView      from './ChartView';
import FeedbackBar    from './FeedbackBar';
import SourceSelector from './SourceSelector';
import QuestionMenu   from './QuestionMenu';
import { useUser }    from '../lib/UserContext';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

// Persist a stable session ID in localStorage so history survives page reloads
function getOrCreateSessionId() {
  if (typeof window === 'undefined') return null;
  let id = localStorage.getItem('afl_session_id');
  if (!id) {
    id = `session_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    localStorage.setItem('afl_session_id', id);
  }
  return id;
}

export default function ChatWindow() {
  const { user, getAuthHeaders, logout } = useUser();
  const [messages,      setMessages]      = useState([]);
  const [input,         setInput]         = useState('');
  const [loading,       setLoading]       = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [source,        setSource]        = useState('bigquery');
  const [dataset,       setDataset]       = useState('DCOE_Production');
  const [table,         setTable]         = useState('t_capillary_rfm_cohort_gold_layer');
  const [sessionId]     = useState(() => getOrCreateSessionId());
  const bottomRef       = useRef(null);
  const textareaRef     = useRef(null);

  // ── Load chat history on mount ─────────────────────────────────────────────
  useEffect(() => {
    if (!sessionId) return;

    async function loadHistory() {
      try {
        const authHeaders = await getAuthHeaders();
        const res  = await fetch(
          `${API_URL}/api/history?sessionId=${encodeURIComponent(sessionId)}`,
          { headers: { 'Content-Type': 'application/json', ...authHeaders } },
        );
        if (!res.ok) {
          console.warn('History fetch failed:', res.status, await res.text());
          return;
        }
        const { turns } = await res.json();
        if (!turns || turns.length === 0) return;

        // Each turn becomes a user message + assistant message pair
        const restored = [];
        for (const turn of turns) {
          restored.push({
            role:      'user',
            content:   turn.question,
            timestamp: turn.timestamp,
          });
          restored.push({
            role:        'assistant',
            content:     turn.explanation || '',
            sql:         turn.sql         || null,
            chart:       turn.chart_config ? JSON.parse(turn.chart_config) : null,
            turnId:      turn.id,
            question:    turn.question,
            aiProvider:  turn.ai_provider || null,
            tablesUsed:  turn.tables_used ? JSON.parse(turn.tables_used) : [],
            rowCount:         turn.row_count        ?? 0,
            executionMs:      turn.execution_ms     ?? 0,
            intent:           turn.intent           || 'QUERY',
            costInfo:         turn.cost_info        ? JSON.parse(turn.cost_info) : null,
            aiCost:           turn.ai_cost          ? JSON.parse(turn.ai_cost)   : null,
            confidenceScore:  turn.confidence_score ?? null,
            confidenceReason: turn.confidence_reason || null,
            timestamp:        turn.timestamp,
            isHistorical: true,
            // Feedback from the joined query
            initialRating: turn.feedback_rating  || null,
            feedbackComment: turn.feedback_comment || null,
          });
        }
        setMessages(restored);
      } catch (err) {
        console.warn('History load error:', err.message);
      } finally {
        setHistoryLoaded(true);
      }
    }

    loadHistory();
  // Re-run when user identity is established (guest login sets user after mount)
  }, [sessionId, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function sendMessage(text) {
    const question = (text || input).trim();
    if (!question || loading) return;

    // Build conversation history for context memory (AI-facing messages only)
    const history = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .slice(-10)
      .map(m => ({
        role:    m.role,
        content: m.role === 'assistant'
          ? `${m.content}${m.sql ? `\n\nGenerated SQL:\n${m.sql}` : ''}${m.rowCount ? `\n\nQuery returned ${m.rowCount} rows.` : ''}`
          : m.content,
      }));

    setMessages(prev => [...prev, { role: 'user', content: question, timestamp: new Date().toISOString() }]);
    setInput('');
    setLoading(true);

    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(`${API_URL}/api/chat`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          question,
          source,
          dataset,
          tables:    table.trim() ? [table.trim()] : [],
          history,
          sessionId,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'An error occurred');

      setMessages(prev => [...prev, {
        role:              'assistant',
        question,
        content:           data.explanation,
        sql:               data.sql,
        chart:             data.chart,
        results:           data.results,
        rowCount:          data.rowCount,
        truncated:         data.truncated,
        costInfo:          data.costInfo,
        aiCost:            data.aiCost,
        executionMs:       data.executionMs,
        aiProvider:        data.aiProvider,
        tablesUsed:        data.tablesUsed,
        turnId:            data.turnId,
        intent:            data.intent,
        fromSemanticCache: data.fromSemanticCache  || false,
        fromResultCache:   data.fromResultCache    || false,
        cacheScore:        data.cacheScore         || null,
        confidenceScore:   data.confidenceScore    ?? null,
        confidenceReason:  data.confidenceReason   || null,
        timestamp:         new Date().toISOString(),
        initialRating:     null,
      }]);

    } catch (err) {
      setMessages(prev => [...prev, { role: 'error', content: err.message }]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  async function rerunQuestion(question) {
    await sendMessage(question);
  }

  function clearHistory() {
    if (!confirm('Start a new session? This will clear the current conversation from view (history is still saved in BigQuery).')) return;
    const newId = `session_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    localStorage.setItem('afl_session_id', newId);
    window.location.reload();
  }

  return (
    <div className="app-shell">

      {/* ── Sidebar ──────────────────────────────────────────────────────── */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-logo">
            <div className="brand-icon">✦</div>
            <span className="brand-name">AIDA</span>
          </div>
          <div className="brand-sub">Arvind Intelligent Data Assistant</div>
        </div>

        <SourceSelector
          source={source}
          dataset={dataset}
          table={table}
          onSourceChange={setSource}
          onDatasetChange={setDataset}
          onTableChange={setTable}
        />

        <QuestionMenu table={table} dataset={dataset} source={source} onSelect={q => sendMessage(q)} />

        <div className="sidebar-footer">
          <div className="status-indicator">
            <span className="status-dot" />
            Connected · {source === 'bigquery' ? 'BigQuery' : 'Fabric'}
          </div>
        </div>
      </aside>

      {/* ── Main ─────────────────────────────────────────────────────────── */}
      <div className="chat-main">

        {/* Top bar */}
        <div className="chat-topbar">
          <span className="topbar-title">AIDA · Conversation Analytics</span>
          <div className="topbar-context">
            <span className="context-badge source">
              {source === 'bigquery' ? '☁ BigQuery' : '⬡ Fabric'}
            </span>
            {dataset && <span className="context-badge dataset">⊞ {dataset}</span>}
            {table   && <span className="context-badge table">◈ {table}</span>}
          </div>
          {user && (
            <div className="topbar-user">
              <div className="user-avatar" title={user.email}>
                {user.name ? user.name.charAt(0).toUpperCase() : '?'}
              </div>
              <div className="user-info">
                <span className="user-name">{user.name}</span>
                <span className="user-email">{user.email}</span>
              </div>
              <button className="logout-btn" onClick={logout} title="Sign out">↪</button>
            </div>
          )}
        </div>

        {/* Messages */}
        <div className="messages-area">
          {historyLoaded && messages.length === 0 && (
            <div className="empty-state">
              <div className="empty-icon">✦</div>
              <h2>Ask anything about your data</h2>
              <p>
                AIDA translates your business questions into SQL,
                runs them against {dataset || 'your dataset'}, and explains the results — no SQL knowledge needed.
              </p>
              <p className="empty-hint">
                ← Pick a category from the left menu, or type your own question below.
              </p>
            </div>
          )}

          {!historyLoaded && (
            <div className="history-loading">
              <span className="dot" /><span className="dot" /><span className="dot" />
              <span style={{ marginLeft: 8, color: 'var(--text-muted)' }}>Loading conversation history…</span>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i}>
              <MessageBubble
                role={msg.role}
                content={msg.content}
                aiProvider={msg.aiProvider}
                timestamp={msg.timestamp}
              />
              {msg.sql     && <SqlPreview sql={msg.sql} costInfo={msg.costInfo} aiCost={msg.aiCost} executionMs={msg.executionMs} fromSemanticCache={msg.fromSemanticCache} fromResultCache={msg.fromResultCache} cacheScore={msg.cacheScore} confidenceScore={msg.confidenceScore} confidenceReason={msg.confidenceReason} />}
              {!msg.sql && msg.fromSemanticCache && (
                <div className="message-row assistant" style={{ marginTop: -8 }}>
                  <div style={{ width: 34, flexShrink: 0 }} />
                  <div className="cache-badge-row">
                    <span className="badge vector-cache">⚡ Vector cache hit{msg.cacheScore ? ` · ${msg.cacheScore}` : ''}</span>
                    <span className="badge time">{msg.executionMs}ms</span>
                  </div>
                </div>
              )}
              {msg.chart   && <ChartView chart={msg.chart} results={msg.results} />}
              {msg.results && msg.results.length > 0 && (
                <ResultsTable results={msg.results} rowCount={msg.rowCount} truncated={msg.truncated} />
              )}
              {msg.isHistorical && msg.intent === 'QUERY' && !msg.results && (
                <div className="rerun-row">
                  <button className="rerun-btn" onClick={() => rerunQuestion(msg.question)} disabled={loading}>
                    ↻ Re-run query to see latest results
                  </button>
                </div>
              )}
              {msg.role === 'assistant' && (
                <FeedbackBar
                  message={msg}
                  source={source}
                  dataset={dataset}
                  sessionId={sessionId}
                  initialRating={msg.initialRating}
                />
              )}
            </div>
          ))}

          {loading && (
            <div className="loading-row">
              <div className="avatar" style={{ background: 'linear-gradient(135deg,#2563EB,#6366F1)' }}>✦</div>
              <div className="loading-bubble">
                <span className="dot" /><span className="dot" /><span className="dot" />
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="input-area">
          <div className="input-box">
            <textarea
              ref={textareaRef}
              className="input-textarea"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask a question about your data…"
              rows={1}
              disabled={loading}
            />
            <button className="send-btn" onClick={() => sendMessage()} disabled={loading || !input.trim()}>
              {loading ? '⏳' : '↑'}
            </button>
          </div>
          <div className="input-hint">Press Enter to send · Shift+Enter for new line</div>
        </div>

      </div>
    </div>
  );
}
