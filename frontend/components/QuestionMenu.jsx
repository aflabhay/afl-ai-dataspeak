/**
 * frontend/components/QuestionMenu.jsx
 * Dynamically generated questions based on actual column metadata for the
 * active table. Questions are fetched from the backend (AI-generated, cached
 * 30 min per table) so they only reference columns that actually exist.
 */
import { useState, useEffect, useRef } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

const DEFAULT_ICONS = ['✦', '📊', '👥', '📈', '🗺', '💎', '🎯', '🏷', '🔗', '🩺'];

export default function QuestionMenu({ table, dataset, source, onSelect }) {
  const [categories, setCategories]   = useState([]);
  const [loading,    setLoading]      = useState(false);
  const [openCats,   setOpenCats]     = useState(new Set());
  const debounceRef                   = useRef(null);
  const lastKeyRef                    = useRef('');

  useEffect(() => {
    if (!table || !dataset) return;

    // Debounce 600 ms — don't fire while user is still typing the table name
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      loadQuestions(table, dataset, source || 'bigquery');
    }, 600);

    return () => clearTimeout(debounceRef.current);
  }, [table, dataset, source]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadQuestions(tableName, ds, src) {
    const key = `${src}.${ds}.${tableName}`;
    if (key === lastKeyRef.current && categories.length > 0) return; // already loaded

    setLoading(true);
    setCategories([]);
    try {
      const url = `${API_URL}/api/questions?table=${encodeURIComponent(tableName)}&dataset=${encodeURIComponent(ds)}&source=${encodeURIComponent(src)}`;
      const res = await fetch(url);
      if (!res.ok) return;
      const { categories: cats } = await res.json();
      lastKeyRef.current = key;
      setCategories(cats || []);

      // Auto-open first category
      if (cats && cats.length > 0) {
        setOpenCats(new Set([cats[0].category]));
      }
    } catch {
      // non-critical
    } finally {
      setLoading(false);
    }
  }

  function toggleCategory(name) {
    setOpenCats(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  if (loading) {
    return (
      <div className="qmenu-loading">
        <span className="dot" /><span className="dot" /><span className="dot" />
        <span className="qmenu-loading-text">Generating questions…</span>
      </div>
    );
  }

  if (categories.length === 0) return null;

  return (
    <div className="qmenu">
      <div className="sidebar-section-title qmenu-header">Quick Questions</div>
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
                    <button
                      className="qmenu-q-btn"
                      onClick={() => onSelect(q)}
                      title={q}
                    >
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
