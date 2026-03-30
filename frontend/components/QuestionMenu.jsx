/**
 * frontend/components/QuestionMenu.jsx
 * - On mount / table change: silently checks BQ for stored questions (checkOnly).
 *   If found → displays them immediately, no button needed.
 *   If not found → shows "Generate Sample Questions" button for manual trigger.
 */
import { useState, useEffect, useRef } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

const DEFAULT_ICONS = ['✦', '📊', '👥', '📈', '🗺', '💎', '🎯', '🏷', '🔗', '🩺'];

export default function QuestionMenu({ table, dataset, source, onSelect }) {
  const [categories,  setCategories]  = useState([]);
  const [checking,    setChecking]    = useState(false); // silent BQ check
  const [generating,  setGenerating]  = useState(false); // manual AI generation
  const [showButton,  setShowButton]  = useState(false); // no stored questions found
  const [openCats,    setOpenCats]    = useState(new Set());
  const debounceRef                   = useRef(null);
  const lastKeyRef                    = useRef('');

  useEffect(() => {
    if (!table || !dataset) { setCategories([]); setShowButton(false); return; }

    const key = `${source || 'bigquery'}.${dataset}.${table}`;
    if (key === lastKeyRef.current) return; // same table — no re-check needed

    // Reset state for new table
    setCategories([]);
    setShowButton(false);

    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => checkStored(table, dataset, source || 'bigquery', key), 600);
    return () => clearTimeout(debounceRef.current);
  }, [table, dataset, source]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Silent BQ check — returns stored questions or shows the generate button ──
  async function checkStored(tableName, ds, src, key) {
    setChecking(true);
    try {
      const url = `${API_URL}/api/questions?table=${encodeURIComponent(tableName)}&dataset=${encodeURIComponent(ds)}&source=${encodeURIComponent(src)}&checkOnly=true`;
      const res = await fetch(url);
      if (!res.ok) { setShowButton(true); return; }
      const { categories: cats } = await res.json();
      if (cats && cats.length > 0) {
        lastKeyRef.current = key;
        setCategories(cats);
        setOpenCats(new Set([cats[0].category]));
        setShowButton(false);
      } else {
        setShowButton(true); // nothing stored → show generate button
      }
    } catch {
      setShowButton(true);
    } finally {
      setChecking(false);
    }
  }

  // ── Manual generation — only called when user clicks the button ─────────────
  async function generateQuestions() {
    if (!table || !dataset || generating) return;
    setGenerating(true);
    setShowButton(false);
    try {
      const src = source || 'bigquery';
      const url = `${API_URL}/api/questions?table=${encodeURIComponent(table)}&dataset=${encodeURIComponent(dataset)}&source=${encodeURIComponent(src)}`;
      const res = await fetch(url);
      if (!res.ok) { setShowButton(true); return; }
      const { categories: cats } = await res.json();
      const key = `${src}.${dataset}.${table}`;
      lastKeyRef.current = key;
      setCategories(cats || []);
      if (cats && cats.length > 0) setOpenCats(new Set([cats[0].category]));
      else setShowButton(true);
    } catch {
      setShowButton(true);
    } finally {
      setGenerating(false);
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

  // Silent checking spinner (very brief)
  if (checking) {
    return (
      <div className="qmenu-loading">
        <span className="dot" /><span className="dot" /><span className="dot" />
      </div>
    );
  }

  // AI generation in progress
  if (generating) {
    return (
      <div className="qmenu-loading">
        <span className="dot" /><span className="dot" /><span className="dot" />
        <span className="qmenu-loading-text">Generating questions…</span>
      </div>
    );
  }

  // No stored questions — show generate button
  if (showButton) {
    return (
      <div className="qmenu-generate-wrap">
        <button className="qmenu-generate-btn" onClick={generateQuestions}>
          ✦ Generate Sample Questions
        </button>
      </div>
    );
  }

  // Questions loaded — display them
  if (categories.length === 0) return null;

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
