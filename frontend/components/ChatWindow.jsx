/**
 * frontend/components/ChatWindow.jsx
 * ────────────────────────────────────
 * Main chat interface component.
 * Handles message state, API calls, and rendering the conversation.
 */

import { useState, useRef, useEffect } from 'react';
import MessageBubble  from './MessageBubble';
import ResultsTable   from './ResultsTable';
import SqlPreview     from './SqlPreview';
import SourceSelector from './SourceSelector';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export default function ChatWindow() {
  const [messages,  setMessages]  = useState([]);
  const [input,     setInput]     = useState('');
  const [loading,   setLoading]   = useState(false);
  const [source,    setSource]    = useState('bigquery');
  const [dataset,   setDataset]   = useState('DCOE_Production');
  const bottomRef = useRef(null);

  // Auto-scroll to latest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function sendMessage() {
    if (!input.trim() || loading) return;

    const userMessage = { role: 'user', content: input };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch(`${API_URL}/api/chat`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ question: input, source, dataset }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'An error occurred');
      }

      const assistantMessage = {
        role:        'assistant',
        content:     data.explanation,
        sql:         data.sql,
        results:     data.results,
        rowCount:    data.rowCount,
        costInfo:    data.costInfo,
        executionMs: data.executionMs,
        aiProvider:  data.aiProvider,
      };

      setMessages(prev => [...prev, assistantMessage]);

    } catch (err) {
      setMessages(prev => [...prev, {
        role:    'error',
        content: err.message,
      }]);
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

  return (
    <div className="chat-container">

      {/* Header */}
      <div className="chat-header">
        <h1>📊 Data Analytics Assistant</h1>
        <p>Ask questions about your data in plain English</p>
        <SourceSelector
          source={source}
          dataset={dataset}
          onSourceChange={setSource}
          onDatasetChange={setDataset}
        />
      </div>

      {/* Messages */}
      <div className="messages-container">
        {messages.length === 0 && (
          <div className="empty-state">
            <p>👋 Ask me anything about your data!</p>
            <p className="examples">Try: <em>"Show me top 10 conversations by resolution time this week"</em></p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i}>
            <MessageBubble role={msg.role} content={msg.content} aiProvider={msg.aiProvider} />
            {msg.sql && <SqlPreview sql={msg.sql} costInfo={msg.costInfo} executionMs={msg.executionMs} />}
            {msg.results && msg.results.length > 0 && (
              <ResultsTable results={msg.results} rowCount={msg.rowCount} />
            )}
          </div>
        ))}

        {loading && (
          <div className="loading-bubble">
            <span className="dot" /><span className="dot" /><span className="dot" />
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="input-container">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask a question about your data... (Enter to send, Shift+Enter for newline)"
          rows={2}
          disabled={loading}
        />
        <button onClick={sendMessage} disabled={loading || !input.trim()}>
          {loading ? '⏳' : '➤ Send'}
        </button>
      </div>

    </div>
  );
}
