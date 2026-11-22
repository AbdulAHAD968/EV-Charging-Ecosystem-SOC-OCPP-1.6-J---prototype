import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LESSONS } from '../data/lessons';
import Handshake from './learn/Handshake';
import Anatomy from './learn/Anatomy';
import { Session, BreakIt } from './learn/Session';
import Quiz from './learn/Quiz';
import './Learn.css';

const VIEWS = { handshake: Handshake, anatomy: Anatomy, session: Session, break: BreakIt, quiz: Quiz };

export default function Learn() {
  const [id, setId] = useState('handshake');
  const [open, setOpen] = useState(false);
  const idx = LESSONS.findIndex((l) => l.id === id);
  const current = LESSONS[idx];
  const View = VIEWS[id];
  const go = (nextId) => { setId(nextId); setOpen(false); };

  return (
    <div className="lrn-page">
      <h1 className="lrn-h1">OCPP Protocol Lab</h1>
      <p className="lrn-lead">Pick a lesson below and press Play. Everything happens in one view so you can keep your eyes on the diagram.</p>

      {/* Step rail: a compact progress strip, not a second navigation column. Each dot is
          clickable, the current lesson is named next to it, and a dropdown offers the
          full list with its description for anyone who wants to jump directly. */}
      <div className="lrn-rail">
        <div className="lrn-dots" role="tablist" aria-label="Lesson progress">
          {LESSONS.map((l, i) => (
            <button
              key={l.id}
              role="tab"
              aria-selected={id === l.id}
              aria-label={`${i + 1}. ${l.title}`}
              title={l.title}
              className={`lrn-dot ${id === l.id ? 'on' : ''} ${i < idx ? 'done' : ''}`}
              onClick={() => go(l.id)}
            >
              {i + 1}
            </button>
          ))}
        </div>

        <div className="lrn-picker">
          <button className="lrn-picker-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="listbox">
            <span className="lrn-picker-num">{idx + 1}/{LESSONS.length}</span>
            <span className="lrn-picker-title">{current.title}</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .18s ease' }}>
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          <AnimatePresence>
            {open ? (
              <>
                <div className="lrn-picker-scrim" onClick={() => setOpen(false)} aria-hidden="true" />
                <motion.div
                  className="lrn-picker-menu" role="listbox"
                  initial={{ opacity: 0, y: -6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.98 }}
                  transition={{ duration: 0.15 }}
                >
                  {LESSONS.map((l, i) => (
                    <button
                      key={l.id} role="option" aria-selected={id === l.id}
                      className={`lrn-picker-item ${id === l.id ? 'on' : ''}`}
                      onClick={() => go(l.id)}
                    >
                      <span className="lrn-lnum">{i + 1}</span>
                      <span><span className="lrn-ltitle">{l.title}</span><span className="lrn-lblurb">{l.blurb}</span></span>
                    </button>
                  ))}
                </motion.div>
              </>
            ) : null}
          </AnimatePresence>
        </div>
      </div>

      <div className="lrn-stepbtns">
        <button className="lrn-btn" disabled={idx <= 0} onClick={() => go(LESSONS[idx - 1].id)}>Previous</button>
        <button className="lrn-btn" disabled={idx >= LESSONS.length - 1} onClick={() => go(LESSONS[idx + 1].id)}>Next lesson</button>
      </div>

      <AnimatePresence mode="wait">
        <motion.main
          key={id}
          className="lrn-stage"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.22 }}
        >
          <View />
        </motion.main>
      </AnimatePresence>
    </div>
  );
}
