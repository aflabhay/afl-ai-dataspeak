/**
 * frontend/components/QuestionMenu.jsx
 * Shows AI-generated suggested questions for the focused table.
 * Questions are NOT auto-generated — user clicks "Generate Sample Questions"
 * to trigger generation. Schema metadata is already warmed by SourceSelector.
 */
import { useState, useRef } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

const DEFAULT_ICONS = ['✦', '📊', '👥', '📈', '🗺', '💎', '🎯', '🏷', '🔗', '🩺'];

export default function QuestionMenu({ table, dataset, source, onSelect }) {
  const [categories, setCategories] = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [triggered,  setTriggered]  = useState(false);
  const [openCats,   setOpenCats]   = useState(new Set());
  const lastKeyRef                  = useRef('');

  // Reset when table/dataset changes so the button reappears for new table
  const currentKey = `${source || 'bigquery'}.${dataset}.${table}`;
  if (lastKeyRef.current && lastKeyRef.current !== currentKey && triggered) {
    setCategories([]);
    setTriggered(false);
    setOpenCats(new Set());
    lastKeyRef.current = '';
  }

  async function generateQuestions() {
    if (!table || !dataset || loading) return;
    setTriggered(true);
    setLoading(true);
    setCategories([]);
    try {
      const src = source || 'bigquery';
      const url = `${API_URL}/api/questions?table=${encodeURIComponent(table)}&dataset=${encodeURIComponent(dataset)}&source=${encodeURIComponent(src)}`;
      const res = await fetch(url);
      if (!res.ok) return;
      const { categories: cats } = await res.json();
      lastKeyRef.current = currentKey;
      setCategories(cats || []);
      // Auto-open first category
      if (cats && cats.length > 0) setOpenCats(new Set([cats[0].category]));
    } catch {
      // non-critical
    } finally {
      setLoading(false);
    }
  }

  function toggleCategory(name) {
    setOpenCats(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  if (!table || !dataset) return null;

  // ── Not yet triggered — show the generate button ──────────────────────────
  if (!triggered) {
    return (
      <div className="qmenu-generate-wrap">
        <button className="qmenu-generate-btn" onClick={generateQuestions}>
          ✦ Generate Sample Questions
        </button>
      </div>
    );
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="qmenu-loading">
        <span className="dot" /><span className="dot" /><span className="dot" />
        <span className="qmenu-loading-text">Generating questions…</span>
      </div>
    );
  }

  // ── No questions returned ─────────────────────────────────────────────────
  if (categories.length === 0) {
    return (
      <div className="qmenu-generate-wrap">
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,.4)' }}>No questions generated.</span>
        <button className="qmenu-generate-btn" style={{ marginTop: 6 }} onClick={() => { setTriggered(false); }}>
          ↻ Retry
        </button>
      </div>
    );
  }

  // ── Questions loaded ──────────────────────────────────────────────────────
  return (
    <div className="qmenu">
      <div className="sidebar-section-title qmenu-header">Sample Questions</div>
      {categories.map(({ category, questions }, idx) => {
        const isOpen = openCats.has(category);
        const icon   = DEFAULT_ICONS[idx % DEFAULT_ICONS.length];
        return (
          <div key={category} className="qmenu-category">
            <button
              className={`qmenu-cat-btn ${isOpen ? 'open' : ''}`}
              onClick={() => toggleCategory(category)}
            >
              <span className="qmenu-cat-icon">{icon}</span>
              <span className="qmenu-cat-name">{category}</span>
              <span className="qmenu-chevron">{isOpen ? '▾' : '▸'}</span>
            </button>
            {isOpen && (
              <ul className="qmenu-questions">
                {questions.map((q, qi) => (
                  <li key={qi}>
                    <button className="qmenu-q-btn" onClick={() => onSelect(q)} title={q}>
                      {q}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
